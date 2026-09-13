import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { realliveKoeFormat } from "../../packages/formats/src/reallive/koe.js";
import { expectArchive } from "../helpers/archive.js";

const CHUNK_SIZE = 0x1000;

/** A chunk is an explicit length plus the bytes it consumes; `undefined` means a silence chunk. */
interface FixtureChunk {
	length: number;
	data?: Buffer;
}

interface FixtureEntry {
	id: number;
	chunks: FixtureChunk[];
}

function silenceChunk(): FixtureChunk {
	return { length: 0 };
}

function pcmChunk(indices: Buffer): FixtureChunk {
	return { length: 0x400, data: indices };
}

function adpcmChunk(data: Buffer): FixtureChunk {
	return { length: data.length, data };
}

/**
 * Builds a KOE archive: an eight byte signature, a header holding the entry count and sample rate, a
 * flat index, and the per entry length tables and audio data.
 */
function buildKoe(
	entries: FixtureEntry[],
	options: {
		sampleRate?: number;
		signature?: string;
		countDelta?: number;
	} = {},
): Buffer {
	const header = Buffer.alloc(0x20);
	// The signature is seven bytes wide: 'KOEP' plus "AC\0".
	header.write(options.signature ?? "KOEPAC\0", 0, 7, "latin1");
	header.writeInt32LE(entries.length + (options.countDelta ?? 0), 0x10);
	header.writeUInt32LE(entries.length * 8 + 0x20, 0x14);
	header.writeUInt32LE(options.sampleRate ?? 22050, 0x18);
	const index = Buffer.alloc(entries.length * 8);
	const payloads: Buffer[] = [];
	let cursor = 0x20 + entries.length * 8;
	entries.forEach((entry, position) => {
		index.writeUInt16LE(entry.id, position * 8);
		index.writeUInt16LE(entry.chunks.length, position * 8 + 2);
		index.writeUInt32LE(cursor, position * 8 + 4);
		const table = Buffer.alloc(entry.chunks.length * 2);
		const parts: Buffer[] = [];
		for (const [index2, chunk] of entry.chunks.entries()) {
			table.writeUInt16LE(chunk.length, index2 * 2);
			if (chunk.data) parts.push(chunk.data);
		}
		const payload = Buffer.concat([table, ...parts]);
		payloads.push(payload);
		cursor += payload.length;
	});
	return Buffer.concat([header, index, ...payloads]);
}

function sourceOf(archive: Buffer): BufferByteSource {
	return new BufferByteSource(archive);
}

describe("reallive KOE", () => {
	it("registers the KOEPAC signature", () => {
		expect(
			realliveKoeFormat.detection?.signatures?.map((signature) =>
				Buffer.from(signature.bytes).toString("latin1"),
			),
		).toEqual(["KOEPAC\0"]);
	});

	it("declines a file with a different signature", async () => {
		const built = buildKoe([{ id: 0, chunks: [silenceChunk()] }], {
			signature: "KOEPAX\0",
		});
		expect(await realliveKoeFormat.detect(sourceOf(built), "GAME.KOE")).toBe(
			false,
		);
	});

	it("declines a file with an insane entry count", async () => {
		const built = buildKoe([{ id: 0, chunks: [silenceChunk()] }], {
			countDelta: 0x100000,
		});
		expect(await realliveKoeFormat.detect(sourceOf(built), "GAME.KOE")).toBe(
			false,
		);
	});

	it("declines an entry whose chunk table leaves the file", async () => {
		const built = buildKoe([
			{ id: 0, chunks: [silenceChunk(), silenceChunk()] },
		]);
		// Claim more chunks than the table holds.
		built.writeUInt16LE(0x1000, 0x22);
		expect(await realliveKoeFormat.detect(sourceOf(built), "GAME.KOE")).toBe(
			false,
		);
	});

	it("lists entries with the archive base name and chunk count", async () => {
		const built = buildKoe([
			{ id: 3, chunks: [silenceChunk()] },
			{ id: 12, chunks: [silenceChunk(), silenceChunk()] },
		]);
		const archive = await realliveKoeFormat.open(sourceOf(built), "GAME.KOE");
		try {
			expect(
				archive.entries.map((entry) => ({
					path: entry.path,
					size: entry.size,
					stored: entry.packedSize,
					type: (entry.metadata as { type?: string }).type,
				})),
			).toEqual([
				{
					path: "GAME#0003.wav",
					size: BigInt(44 + CHUNK_SIZE),
					stored: 2n,
					type: "audio",
				},
				{
					path: "GAME#0012.wav",
					size: BigInt(44 + 2 * CHUNK_SIZE),
					stored: 4n,
					type: "audio",
				},
			]);
		} finally {
			await archive.close();
		}
	});

	it("falls back to the default sample rate when the header has none", async () => {
		const built = buildKoe([{ id: 0, chunks: [silenceChunk()] }], {
			sampleRate: 0,
		});
		const archive = await realliveKoeFormat.open(sourceOf(built), "GAME.KOE");
		try {
			expect(archive.metadata).toMatchObject({ sampleRate: 22050 });
		} finally {
			await archive.close();
		}
	});

	it("writes a stereo 16 bit riff header around the decodes", async () => {
		const built = buildKoe([{ id: 0, chunks: [silenceChunk()] }], {
			sampleRate: 44100,
		});
		const archive = await realliveKoeFormat.open(sourceOf(built), "GAME.KOE");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(44 + CHUNK_SIZE);
			expect(output.toString("latin1", 0, 4)).toBe("RIFF");
			expect(output.toString("latin1", 8, 12)).toBe("WAVE");
			expect(output.readUInt32LE(4)).toBe(0x24 + CHUNK_SIZE);
			expect(output.readUInt16LE(0x14)).toBe(1);
			expect(output.readUInt16LE(0x16)).toBe(2);
			expect(output.readUInt32LE(0x18)).toBe(44100);
			expect(output.readUInt32LE(0x1c)).toBe(4 * 44100);
			expect(output.readUInt16LE(0x20)).toBe(4);
			expect(output.readUInt16LE(0x22)).toBe(16);
			expect(output.readUInt32LE(0x28)).toBe(CHUNK_SIZE);
			expect(output.subarray(44).every((value) => value === 0)).toBe(true);
		} finally {
			await archive.close();
		}
	});

	it("expands a silence chunk to zero samples", async () => {
		const built = buildKoe([{ id: 0, chunks: [silenceChunk()] }]);
		const archive = await realliveKoeFormat.open(sourceOf(built), "GAME.KOE");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.subarray(44)).toEqual(Buffer.alloc(CHUNK_SIZE));
		} finally {
			await archive.close();
		}
	});

	it("maps pcm chunk bytes through the sample table", async () => {
		// SampleTable[0] is 0x8000 and SampleTable[1] is 0x81FF, both written as stereo pairs.
		const indices = Buffer.alloc(0x400);
		indices[0] = 0;
		indices[1] = 1;
		const built = buildKoe([
			{ id: 0, chunks: [pcmChunk(indices), silenceChunk()] },
		]);
		const archive = await realliveKoeFormat.open(sourceOf(built), "GAME.KOE");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16LE(44)).toBe(0x8000);
			expect(output.readUInt16LE(46)).toBe(0x8000);
			expect(output.readUInt16LE(48)).toBe(0x81ff);
			expect(output.readUInt16LE(50)).toBe(0x81ff);
			// The remaining PCM indices are zero as well.
			expect(output.readUInt16LE(52)).toBe(0x8000);
			// The second chunk is silence, which decodes to zero samples.
			expect(output.readUInt16LE(44 + CHUNK_SIZE)).toBe(0);
		} finally {
			await archive.close();
		}
	});

	it("decodes an all zero adpcm chunk to a constant sample", async () => {
		const adpcm = Buffer.alloc(0x200);
		const built = buildKoe([{ id: 5, chunks: [adpcmChunk(adpcm)] }]);
		const archive = await realliveKoeFormat.open(sourceOf(built), "GAME.KOE");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.size).toBe(BigInt(44 + CHUNK_SIZE));
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(44 + CHUNK_SIZE);
			// Every nibble is zero, which leaves the running index at zero.
			const samples = output.subarray(44);
			expect(samples.readUInt16LE(0)).toBe(0x8000);
			expect(samples.readUInt16LE(CHUNK_SIZE / 2 - 2)).toBe(0x8000);
		} finally {
			await archive.close();
		}
	});

	it("extracts listed entries through the archive helper", async () => {
		const built = buildKoe([
			{ id: 1, chunks: [silenceChunk(), silenceChunk()] },
		]);
		await expectArchive({
			format: realliveKoeFormat,
			archive: built,
			sourcePath: "VOICE.KOE",
			entries: [{ path: "VOICE#0001.wav", size: 44 + 2 * CHUNK_SIZE }],
		});
	});

	it("keeps the extracted size independent of the chunk split", async () => {
		const built = buildKoe([
			{
				id: 0,
				chunks: [silenceChunk(), pcmChunk(Buffer.alloc(0x400)), silenceChunk()],
			},
		]);
		const archive = await realliveKoeFormat.open(sourceOf(built), "GAME.KOE");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.size).toBe(BigInt(44 + 3 * CHUNK_SIZE));
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(44 + 3 * CHUNK_SIZE);
		} finally {
			await archive.close();
		}
	});
});
