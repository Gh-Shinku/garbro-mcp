import {
	BufferByteSource,
	encodeCp932,
	extractArchive,
	GarbroError,
} from "@garbro-mcp/core";
import { AfsFormat } from "@garbro-mcp/formats";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

function buildAfs(): { archive: Buffer; contents: Buffer[] } {
	const definitions = [
		{ name: "hello.txt", content: Buffer.from("hello afs\n") },
		{ name: "音声.wav", content: Buffer.from("synthetic wave") },
	];
	const offsets = [0x800, 0x900];
	const lastDefinition = definitions.at(-1);
	if (!lastDefinition) throw new Error("AFS fixture requires an entry");
	const lastEnd = (offsets.at(-1) ?? 0) + lastDefinition.content.length;
	const namesOffset = Math.ceil(lastEnd / 0x800) * 0x800;
	const archive = Buffer.alloc(namesOffset + definitions.length * 0x30);
	archive.write("AFS\0", 0, "binary");
	archive.writeInt32LE(definitions.length, 4);
	for (const [index, definition] of definitions.entries()) {
		archive.writeUInt32LE(offsets[index] ?? 0, 8 + index * 8);
		archive.writeUInt32LE(definition.content.length, 12 + index * 8);
		definition.content.copy(archive, offsets[index]);
		encodeCp932(definition.name).copy(archive, namesOffset + index * 0x30);
	}
	return { archive, contents: definitions.map(({ content }) => content) };
}

describe("CRI AFS", () => {
	it("reads the aligned CP932 filename table and extracts entries", async () => {
		const fixture = buildAfs();
		const archive = await new AfsFormat().open(
			new BufferByteSource(fixture.archive),
			"sample.afs",
		);
		const outputDirectory = await mkdtemp(
			resolve(tmpdir(), "garbro-afs-test-"),
		);
		temporaryDirectories.push(outputDirectory);
		try {
			expect(archive.entries).toMatchObject([
				{ id: "0", path: "hello.txt", size: 10n },
				{ id: "1", path: "音声.wav", size: 14n },
			]);
			const result = await extractArchive(archive, { outputDirectory });
			for (const [index, extracted] of result.files.entries()) {
				expect(await readFile(extracted.outputPath)).toEqual(
					fixture.contents[index],
				);
			}
		} finally {
			await archive.close();
		}
	});

	it("rejects a filename table outside the archive", async () => {
		const fixture = buildAfs().archive.subarray(0, 0x920);
		await expect(
			new AfsFormat().open(new BufferByteSource(fixture), "truncated.afs"),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
