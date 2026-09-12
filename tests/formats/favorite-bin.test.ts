import {
	BufferByteSource,
	encodeCp932,
	extractArchive,
	GarbroError,
} from "@garbro-mcp/core";
import { FavoriteBinFormat } from "@garbro-mcp/formats";
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

function buildArchive(
	definitions: Array<{ name: string; content: Buffer }>,
): Buffer {
	const names = definitions.map(({ name }) =>
		Buffer.concat([encodeCp932(name), Buffer.from([0])]),
	);
	const nameIndex = Buffer.concat(names);
	const dataOffset = 8 + definitions.length * 12 + nameIndex.length;
	const header = Buffer.alloc(8);
	header.writeInt32LE(definitions.length, 0);
	header.writeUInt32LE(nameIndex.length, 4);
	const index = Buffer.alloc(definitions.length * 12);
	let filenameOffset = 0;
	let offset = dataOffset;
	for (const [entryIndex, definition] of definitions.entries()) {
		index.writeUInt32LE(filenameOffset, entryIndex * 12);
		index.writeUInt32LE(offset, entryIndex * 12 + 4);
		index.writeUInt32LE(definition.content.length, entryIndex * 12 + 8);
		filenameOffset += names[entryIndex]?.length ?? 0;
		offset += definition.content.length;
	}
	return Buffer.concat([
		header,
		index,
		nameIndex,
		...definitions.map(({ content }) => content),
	]);
}

describe("Favorite View Point BIN", () => {
	it("lists CP932 names and infers known content extensions", async () => {
		const wave = Buffer.concat([
			Buffer.from("RIFF"),
			Buffer.alloc(4),
			Buffer.from("WAVEpayload"),
		]);
		const archiveData = buildArchive([
			{ name: "音声", content: wave },
			{ name: "背景", content: Buffer.from("hzc1payload") },
			{ name: "config.dat", content: Buffer.from("plain") },
		]);
		const archive = await new FavoriteBinFormat().open(
			new BufferByteSource(archiveData),
			"sample.bin",
		);
		const outputDirectory = await mkdtemp(
			resolve(tmpdir(), "garbro-favorite-bin-test-"),
		);
		temporaryDirectories.push(outputDirectory);
		try {
			expect(archive.entries).toMatchObject([
				{
					path: "音声.wav",
					metadata: { inferredType: "audio", contentSignature: "RIFF/WAVE" },
				},
				{
					path: "背景.hzc",
					metadata: { inferredType: "image", contentSignature: "hzc1" },
				},
				{ path: "config.dat" },
			]);
			const result = await extractArchive(archive, { outputDirectory });
			expect(await readFile(result.files[0]?.outputPath ?? "")).toEqual(wave);
		} finally {
			await archive.close();
		}
	});

	it("rejects filename offsets outside the name index", async () => {
		const malformed = buildArchive([
			{ name: "entry", content: Buffer.from("payload") },
		]);
		malformed.writeUInt32LE(0xffff, 8);
		await expect(
			new FavoriteBinFormat().open(
				new BufferByteSource(malformed),
				"malformed.bin",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
