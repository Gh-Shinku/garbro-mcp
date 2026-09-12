import {
	GarbroError,
	extractEntry,
	normalizeArchivePath,
	type ArchiveHandle,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Readable } from "node:stream";
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
});
