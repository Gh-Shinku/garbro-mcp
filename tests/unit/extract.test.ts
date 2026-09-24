import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import {
	type ArchiveHandle,
	extractEntry,
	extractionPathForEntry,
	type FormatDescriptor,
	GarbroError,
	normalizeArchivePath,
} from "@garbro-mcp/core";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const descriptor: FormatDescriptor = {
	id: "test",
	name: "Test",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [],
};

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(resolve(tmpdir(), "garbro-core-test-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("safe extraction", () => {
	it.each([
		"../escape",
		"/absolute",
		"C:\\drive",
		"folder/../escape",
		"file:stream",
	])("rejects unsafe path %s", (path) =>
		expect(() => normalizeArchivePath(path)).toThrow(GarbroError),
	);

	it("writes by entry ID and refuses overwrite by default", async () => {
		const outputDirectory = await temporaryDirectory();
		const archive: ArchiveHandle = {
			sourcePath: "memory",
			format: descriptor,
			size: 7n,
			metadata: {},
			entries: [
				{
					id: "0",
					path: "folder/file.bin",
					size: 7n,
					packedSize: 7n,
					compressed: false,
					encrypted: false,
				},
			],
			async openEntry() {
				return Readable.from([Buffer.from("payload")]);
			},
			async close() {},
		};

		const first = await extractEntry(archive, "0", { outputDirectory });
		expect(await readFile(first.outputPath, "utf8")).toBe("payload");
		await expect(
			extractEntry(archive, "0", { outputDirectory }),
		).rejects.toMatchObject({
			code: "OUTPUT_EXISTS",
		});

		await writeFile(first.outputPath, "old");
		await extractEntry(archive, "0", { outputDirectory, overwrite: true });
		expect(await readFile(first.outputPath, "utf8")).toBe("payload");
	});

	it("accepts entries whose output size is not declared", async () => {
		const outputDirectory = await temporaryDirectory();
		const archive: ArchiveHandle = {
			sourcePath: "memory",
			format: descriptor,
			size: 4n,
			metadata: {},
			entries: [
				{
					id: "0",
					path: "stream.bin",
					// The decoder produces more bytes than the stored size, which is allowed when the
					// entry declares that its size is not exact.
					size: 4n,
					sizeKnown: false,
					packedSize: 4n,
					compressed: true,
					encrypted: false,
				},
			],
			async openEntry() {
				return Readable.from([Buffer.from("decompressed payload")]);
			},
			async close() {},
		};

		const extracted = await extractEntry(archive, "0", { outputDirectory });
		expect(extracted.bytesWritten).toBe(20n);
		expect(await readFile(extracted.outputPath, "utf8")).toBe(
			"decompressed payload",
		);
	});

	it("uses a safe detected extension without changing the original entry", async () => {
		const outputDirectory = await temporaryDirectory();
		const entry = {
			id: "0",
			path: "opaque/0123456789ABCDEF",
			size: 4n,
			packedSize: 4n,
			compressed: false,
			encrypted: false,
			metadata: { type: "audio", outputExtension: "OGG" },
		};
		const archive: ArchiveHandle = {
			sourcePath: "memory",
			format: descriptor,
			size: 4n,
			metadata: {},
			entries: [entry],
			async openEntry() {
				return Readable.from([Buffer.from("OggS")]);
			},
			async close() {},
		};

		expect(extractionPathForEntry(entry)).toBe("opaque/0123456789ABCDEF.ogg");
		const extracted = await extractEntry(archive, "0", { outputDirectory });
		expect(extracted.entry.path).toBe("opaque/0123456789ABCDEF");
		expect(extracted.outputPath).toBe(
			resolve(outputDirectory, "opaque/0123456789ABCDEF.ogg"),
		);
		expect(await readFile(extracted.outputPath, "utf8")).toBe("OggS");
	});

	it("rejects an unsafe format-provided output extension", () => {
		expect(() =>
			extractionPathForEntry({
				id: "0",
				path: "opaque",
				size: 0n,
				packedSize: 0n,
				compressed: false,
				encrypted: false,
				metadata: { outputExtension: "../ogg" },
			}),
		).toThrow(GarbroError);
	});

	it("still rejects an undeclared size mismatch", async () => {
		const outputDirectory = await temporaryDirectory();
		const archive: ArchiveHandle = {
			sourcePath: "memory",
			format: descriptor,
			size: 4n,
			metadata: {},
			entries: [
				{
					id: "0",
					path: "short.bin",
					size: 4n,
					packedSize: 4n,
					compressed: true,
					encrypted: false,
				},
			],
			async openEntry() {
				return Readable.from([Buffer.from("x")]);
			},
			async close() {},
		};

		await expect(
			extractEntry(archive, "0", { outputDirectory }),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});
});
