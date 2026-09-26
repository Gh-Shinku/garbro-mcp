// The sound of the Cri engine, against heads built in the test: the word of the head (which the reference
// reads with the high bit of every byte cleared), the counts of the walk of the head of it (`fmt`, `comp`,
// `loop`, `ciph`, `rva`, `ath`), the counts of the channels of the sound and the count of the places of the
// counts of a block of it.
import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { criHcaAudioFormat, readHcaHeader } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";

/** The counts of the places of the count of the walk of the head of a sound of the engine. */
const FMT_BODY = 12;
const COMP_BODY = 12;
const DEC_BODY = 12;
const RVA_BODY = 4;

/** The kinds of the counts of the walk of the head of a sound of the engine, of the counts they stand of. */
type ChunkKind = "plain" | "unknown" | "no-ath" | "no-comp";

interface HeadInput {
	word?: number[];
	version?: number;
	channels?: number;
	sampleRate?: number;
	blockCount?: number;
	blockSize?: number;
	r?: number[];
	cipherType?: number;
	athType?: number;
	chunks?: ChunkKind;
}

/** A word of the walk of the head of a sound of the engine, of the counts of the places of it. */
function chunk(id: string, body: Buffer): Buffer {
	const head = Buffer.alloc(4, 0);
	head.write(id, 0, "latin1");
	return Buffer.concat([head, body]);
}

/** A sound of the engine: the head of it and the frames of it, which this port does not walk. */
function hcaFile(input: HeadInput = {}): Buffer {
	const chunks: Buffer[] = [];
	const kind = input.chunks ?? "plain";
	if ("no-comp" !== kind) {
		const format = Buffer.alloc(FMT_BODY, 0);
		format.writeUInt32BE(
			(((input.channels ?? 2) << 24) | (input.sampleRate ?? 44100)) >>> 0,
			0,
		);
		format.writeUInt32BE(input.blockCount ?? 32, 4);
		chunks.push(chunk("fmt\0", format));
		const comp = Buffer.alloc(COMP_BODY, 0);
		comp.writeUInt16BE(input.blockSize ?? 0x200, 0);
		for (const [at, place] of (input.r ?? [0, 0, 1, 0, 6, 5, 4, 3]).entries())
			comp[2 + at] = place;
		chunks.push(chunk("comp", comp));
	}
	const cipher = chunk(
		"ciph",
		Buffer.from([(input.cipherType ?? 0) >> 8, (input.cipherType ?? 0) & 0xff]),
	);
	const rva = Buffer.alloc(RVA_BODY, 0);
	rva.writeFloatBE(1, 0);
	const ath = chunk(
		"ath\0",
		Buffer.from([(input.athType ?? 0) >> 8, (input.athType ?? 0) & 0xff]),
	);
	if ("unknown" === kind) {
		// The reference names no count of the places of a count of the head at all, so the walk ends at the
		// count of the places of the walk of a sound of the engine it does not know.
		chunks.push(
			chunk("dec\0", Buffer.alloc(DEC_BODY, 0)),
			cipher,
			chunk("rva\0", rva),
			ath,
		);
	} else if ("plain" === kind) {
		chunks.push(cipher, chunk("rva\0", rva), ath);
	}
	const body = Buffer.concat(chunks);
	const head = Buffer.alloc(8, 0);
	for (const [at, place] of (input.word ?? [0x48, 0x43, 0x41, 0x00]).entries())
		head[at] = place;
	head.writeUInt16BE(input.version ?? 0x200, 4);
	head.writeUInt16BE(8 + body.length, 6);
	return Buffer.concat([head, body, Buffer.alloc(input.blockSize ?? 0x200, 0)]);
}

async function detect(data: Buffer): Promise<boolean> {
	return criHcaAudioFormat.detect(new BufferByteSource(data), "sound.hca");
}

describe("Cri engine sound", () => {
	it("reads the word and the counts of the walk of the head of it", async () => {
		const data = hcaFile({
			channels: 2,
			sampleRate: 44100,
			blockCount: 32,
			blockSize: 0x200,
		});
		expect(await detect(data)).toBe(true);
		const handle = await criHcaAudioFormat.open(
			new BufferByteSource(data),
			"sound.hca",
		);
		try {
			expect(handle.metadata).toMatchObject({
				audio: "wav",
				compression: "hca",
				sampleRate: 44100,
				channels: 2,
				frames: 32,
				blockSize: 0x200,
				version: 0x200,
			});
			expect(handle.entries).toHaveLength(1);
			expect(handle.entries[0]?.path).toBe("sound.wav");
			// The frames of the sound stand behind the counts of the walk of the head of it: the word of the
			// head of eight bytes and the counts of the walk of the engine, of the counts of the places of
			// every one of them.
			expect(readHcaHeader(data)?.dataOffset).toBe(
				8 +
					(4 + FMT_BODY) +
					(4 + COMP_BODY) +
					(4 + 2) +
					(4 + RVA_BODY) +
					(4 + 2),
			);
			expect(handle.entries[0]?.size).toBe(
				BigInt(data.length - (readHcaHeader(data)?.dataOffset ?? 0)),
			);
			expect(handle.entries[0]?.metadata).toMatchObject({
				type: "audio",
				sampleRate: 44100,
				channels: 2,
				frames: 32,
				// Eight counts of the places of a block of the walk of the engine stand of one frame of it.
				samples: 32 * 0x80 * 8,
			});
		} finally {
			await handle.close();
		}
	});

	it("reads a head whose bytes stand of their high bits", async () => {
		// The reference clears the high bit of every byte of every word of the head, so a head whose bytes
		// stand of those bits stands of the same counts of the walk of the engine.
		const data = hcaFile({ word: [0xc8, 0xc3, 0xc1, 0x80] });
		expect(await detect(data)).toBe(true);
		expect(readHcaHeader(data)?.channels).toBe(2);
	});

	it("stands of the count of the walk of the head at a count it does not know", async () => {
		const known = readHcaHeader(hcaFile({ cipherType: 5, chunks: "plain" }));
		expect(known?.cipherType).toBe(5);
		expect(known?.athType).toBe(0);
		const unknown = readHcaHeader(
			hcaFile({ cipherType: 5, chunks: "unknown" }),
		);
		expect(unknown?.cipherType).toBe(0);
		expect(unknown?.athType).toBe(0);
		// The counts of the walk of the engine of a sound of a head of no counts of the walk of the engine
		// itself at all stand of their places of the counts of the walk of the engine of the head of it.
		expect(readHcaHeader(hcaFile({ version: 0x100 }))?.athType).toBe(0);
		expect(
			readHcaHeader(hcaFile({ version: 0x100, chunks: "no-ath" }))?.athType,
		).toBe(1);
		expect(
			readHcaHeader(hcaFile({ version: 0x200, chunks: "no-ath" }))?.athType,
		).toBe(0);
	});

	it("stands of the counts of the channels of the sound", async () => {
		const map = (channels: number, r: number[]): number[] | undefined =>
			readHcaHeader(hcaFile({ channels, r }))?.channelMap;
		// The counts of the places of the walk of the engine stand of the counts of the places of the
		// channels of the sound, which the reference works out of the count of the counts of the places of a
		// block of it and the counts of the walk of the engine itself.
		expect(map(2, [0, 0, 1, 0, 0, 0, 1, 0])).toEqual([1, 2]);
		expect(map(3, [0, 0, 1, 0, 0, 0, 1, 0])).toEqual([1, 2, 0]);
		expect(map(6, [0, 0, 2, 0, 0, 0, 1, 0])).toEqual([1, 2, 0, 1, 2, 0]);
		expect(map(8, [0, 0, 1, 0, 0, 0, 1, 0])).toEqual([1, 2, 0, 0, 1, 2, 1, 2]);
		expect(map(4, [0, 0, 1, 0, 0, 0, 1, 0])).toEqual([1, 2, 1, 2]);
		// A sound of no counts of the places of a block of the walk of the engine at all stands of no counts
		// of the places of the channels of it, which stand of the places of the counts of the walk of the
		// engine of the head of it all the same.
		expect(map(4, [0, 0, 1, 0, 0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
	});

	it("works the count of the places of the counts of a block as the reference does", async () => {
		// The reference adds a place of a count wherever a remainder stands, and C# stands of a division
		// toward zero: for a count of the places of the counts behind zero the count of the places of them
		// stands *above* the count the places of them work out to.
		expect(readHcaHeader(hcaFile({ r: [0, 0, 1, 0, 1, 4, 3, 2] }))?.r9).toBe(
			-3,
		);
		expect(readHcaHeader(hcaFile({ r: [0, 0, 1, 0, 0, 4, 3, 2] }))?.r9).toBe(
			-2,
		);
		expect(readHcaHeader(hcaFile({ r: [0, 0, 1, 0, 12, 4, 3, 2] }))?.r9).toBe(
			3,
		);
		expect(readHcaHeader(hcaFile({ r: [0, 0, 1, 0, 12, 4, 3, 0] }))?.r9).toBe(
			0,
		);
	});

	it("turns away a head of the counts of the walk of the engine of no sound at all", async () => {
		expect(await detect(Buffer.from("NOTA", "latin1"))).toBe(false);
		expect(await detect(Buffer.alloc(4))).toBe(false);
		expect(readHcaHeader(hcaFile({ channels: 0 }))).toBeUndefined();
		expect(readHcaHeader(hcaFile({ channels: 17 }))).toBeUndefined();
		expect(readHcaHeader(hcaFile({ blockSize: 7 }))).toBeUndefined();
		expect(readHcaHeader(hcaFile({ chunks: "no-comp" }))).toBeUndefined();
	});

	it("stands of the frames of the sound of the engine unported", async () => {
		const data = hcaFile();
		const handle = await criHcaAudioFormat.open(
			new BufferByteSource(data),
			"sound.hca",
		);
		try {
			const entry = handle.entries[0];
			if (!entry) throw new Error("no entry");
			await expect(handle.openEntry(entry.id)).rejects.toThrowError(
				GarbroError,
			);
			await expect(handle.openEntry(entry.id)).rejects.toMatchObject({
				code: "UNSUPPORTED_FEATURE",
			});
		} finally {
			await handle.close();
		}
	});
});
