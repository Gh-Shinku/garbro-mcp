import {
	FormatRegistry,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

function testFormat(
	id: string,
	options: {
		extensions?: string[];
		signature?: Uint8Array;
		priority?: number;
		extensionFallback?: boolean;
		detected?: boolean;
		onDetect?: () => void;
	},
): ArchiveFormat {
	const descriptor: FormatDescriptor = {
		id,
		name: id,
		extensions: options.extensions ?? [],
		capabilities: {
			detect: true,
			list: true,
			extract: true,
			create: false,
			encryption: false,
		},
		attribution: [],
	};
	return {
		descriptor,
		detection: {
			...(options.signature
				? { signatures: [{ bytes: options.signature }] }
				: {}),
			...(options.priority === undefined ? {} : { priority: options.priority }),
			...(options.extensionFallback === undefined
				? {}
				: { extensionFallback: options.extensionFallback }),
		},
		async detect() {
			options.onDetect?.();
			return options.detected ?? true;
		},
		async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
			return {
				sourcePath,
				format: descriptor,
				size: source.size,
				metadata: {},
				entries: [],
				async openEntry() {
					return Readable.from([]);
				},
				async close() {
					await source.close();
				},
			};
		},
	};
}

async function fixture(name: string, contents: Uint8Array): Promise<string> {
	const directory = await mkdtemp(resolve(tmpdir(), "garbro-registry-test-"));
	temporaryDirectories.push(directory);
	const path = resolve(directory, name);
	await writeFile(path, contents);
	return path;
}

describe("FormatRegistry detection catalog", () => {
	it("tries matching signatures before extension and priority fallbacks", async () => {
		const path = await fixture("sample.dat", Buffer.from("MAGIC payload"));
		const registry = new FormatRegistry([
			testFormat("fallback", { extensions: ["dat"], priority: 100 }),
			testFormat("signature", {
				extensions: ["bin"],
				signature: Buffer.from("MAGIC"),
			}),
		]);

		await expect(registry.detectArchive(path)).resolves.toMatchObject({
			format: { id: "signature" },
		});
	});

	it("does not invoke a parser when its required signature does not match", async () => {
		const path = await fixture("sample.bin", Buffer.from("OTHER"));
		let calls = 0;
		const registry = new FormatRegistry([
			testFormat("signed", {
				signature: Buffer.from("MAGIC"),
				onDetect: () => {
					calls += 1;
				},
			}),
		]);

		await expect(registry.detectArchive(path)).resolves.toBeUndefined();
		expect(calls).toBe(0);
	});

	it("allows explicitly declared extension fallback after a signature miss", async () => {
		const path = await fixture("sample.pkg", Buffer.from("OTHER"));
		const registry = new FormatRegistry([
			testFormat("variant", {
				extensions: ["pkg"],
				signature: Buffer.from("MAGIC"),
				extensionFallback: true,
			}),
		]);

		await expect(registry.detectArchive(path)).resolves.toMatchObject({
			format: { id: "variant" },
		});
	});
});
