// The sound of the Cri engine, against heads built in the test: the word of the head (which the reference
// reads with the high bit of every byte cleared), the counts of the walk of the head of it (`fmt`, `comp`,
// `loop`, `ciph`, `rva`, `ath`), the counts of the channels of the sound and the count of the places of the
// counts of a block of it.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import {
	checkHcaBlock,
	criHcaAudioFormat,
	createHcaCipher,
	decipherHcaBlock,
	readHcaAthTable,
	readHcaHeader,
	readHcaSound,
} from "@garbro-mcp/formats";
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
	/** The counts of the places of the frames of the sound of the engine, where they stand. */
	frames?: Buffer;
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
	return Buffer.concat([
		head,
		body,
		input.frames ?? Buffer.alloc(input.blockSize ?? 0x200, 0),
	]);
}

/** A frame of a sound of the engine: the counts of the walk of the engine and the counts of the walk of them. */
function hcaFrame(payload: Buffer, blockSize: number): Buffer {
	const frame = Buffer.alloc(blockSize, 0);
	payload.copy(frame, 0);
	// The counts of the places of the walk of the engine stand of the counts of the places of the block
	// itself: the last two counts of the block stand of the counts of the walk of the engine of the places of
	// the block of the sound of the engine that stand in front of them.
	for (let place = 0; place <= 0xffff; place += 1) {
		frame.writeUInt16BE(place, blockSize - 2);
		if (0 === checkHcaBlock(frame)) return frame;
	}
	throw new Error("no counts of the places of the walk of the engine");
}

/**
 * The counts of the walk of the engine of a frame of a sound of the engine of the counts of the places of a
 * picture of the engine of no count of the walk of the engine at all: the word of the head of the frame, the
 * counts of the walk of the engine of the counts of the walk of the engine itself, and the counts of the
 * places of the picture of the engine of every count of the places of the sound of the engine.
 */
function silentFrame(blockSize: number): Buffer {
	const payload = Buffer.alloc(9, 0);
	payload[0] = 0xff;
	payload[1] = 0xff;
	return hcaFrame(payload, blockSize);
}

/** The counts of the places of a sound of the engine of a wave container. */
function waveOf(data: Buffer): {
	channels: number;
	sampleRate: number;
	bits: number;
	pcm: Buffer;
} {
	if ("RIFF" !== data.toString("latin1", 0, 4))
		throw new Error("no wave container");
	const size = data.readUInt32LE(40);
	return {
		channels: data.readUInt16LE(22),
		sampleRate: data.readUInt32LE(24),
		bits: data.readUInt16LE(34),
		pcm: data.subarray(44, 44 + size),
	};
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

	it("stands of the counts of the places of a sound of the engine of no counts of them", async () => {
		// The counts of the places of the picture of the engine of a frame of the walk of the engine of no
		// counts of the walk of the engine at all stand of the counts of the places of the engine of no
		// count of them at all, and the counts of the places of a frame of a sound of the engine of the
		// counts of the walk of the engine stand of the counts of the places of the walk of the engine.
		const data = hcaFile({
			channels: 2,
			blockCount: 1,
			blockSize: 0x40,
			frames: silentFrame(0x40),
		});
		expect(await detect(data)).toBe(true);
		const handle = await criHcaAudioFormat.open(
			new BufferByteSource(data),
			"sound.hca",
		);
		try {
			const entry = handle.entries[0];
			if (!entry) throw new Error("no entry");
			const wave = waveOf(
				await consumeBuffer(await handle.openEntry(entry.id)),
			);
			expect(wave).toMatchObject({ channels: 2, sampleRate: 44100, bits: 16 });
			// Eight counts of the places of a block of the walk of the engine stand of every frame of the
			// walk of the engine, of every count of the places of the sound of the engine of it.
			expect(wave.pcm).toHaveLength(0x80 * 8 * 2 * 2);
			expect(wave.pcm.every((place) => 0 === place)).toBe(true);
		} finally {
			await handle.close();
		}
	});

	it("stands of the counts of the places of the frames of the sound of the engine", async () => {
		// A frame of a sound of the engine of the counts of the walk of the engine of no count of the places
		// of the block of the walk of the engine stands of no sound of the engine at all.
		const frame = silentFrame(0x40);
		frame[0] = (frame[0] ?? 0) ^ 0xff;
		const broken = hcaFile({
			channels: 2,
			blockCount: 1,
			blockSize: 0x40,
			frames: frame,
		});
		const handle = await criHcaAudioFormat.open(
			new BufferByteSource(broken),
			"sound.hca",
		);
		try {
			const entry = handle.entries[0];
			if (!entry) throw new Error("no entry");
			await expect(handle.openEntry(entry.id)).rejects.toMatchObject({
				code: "INVALID_ARCHIVE",
			});
		} finally {
			await handle.close();
		}
		// A sound of the engine whose frames stand behind the end of the sound of the engine stands of no
		// counts of the places of the picture of the engine at all.
		const short = hcaFile({
			channels: 2,
			blockCount: 4,
			blockSize: 0x40,
			frames: silentFrame(0x40),
		});
		const handle2 = await criHcaAudioFormat.open(
			new BufferByteSource(short),
			"sound.hca",
		);
		try {
			const entry = handle2.entries[0];
			if (!entry) throw new Error("no entry");
			await expect(handle2.openEntry(entry.id)).rejects.toMatchObject({
				code: "INVALID_ARCHIVE",
			});
		} finally {
			await handle2.close();
		}
	});

	it("stands of the counts of the places of the picture of the engine of the frame in front of it", async () => {
		// A frame of the engine of no counts of the walk of the engine at all stands of the counts of the
		// places of the frame that stands in front of it, as the reference stands of them.
		const silent = hcaFile({
			channels: 1,
			blockCount: 2,
			blockSize: 0x40,
			frames: Buffer.concat([
				silentFrame(0x40),
				hcaFrame(Buffer.alloc(9, 0), 0x40),
			]),
		});
		const handle = await criHcaAudioFormat.open(
			new BufferByteSource(silent),
			"sound.hca",
		);
		try {
			const entry = handle.entries[0];
			if (!entry) throw new Error("no entry");
			const wave = waveOf(
				await consumeBuffer(await handle.openEntry(entry.id)),
			);
			expect(wave.pcm).toHaveLength(2 * 0x80 * 8 * 1 * 2);
			expect(wave.pcm.every((place) => 0 === place)).toBe(true);
		} finally {
			await handle.close();
		}
	});
});

describe("Cri engine sound walks", () => {
	it("stands of the counts of the places of a sound of the engine", () => {
		// The reference stands of no counts of the places of a sound of the engine at all for the kind of no
		// count of them, and of the counts of the list of the places of the counts of them for the kind of one
		// count, which stand of the counts of the places of the sound of the engine itself.
		expect([...(readHcaAthTable(0, 44100) ?? [])]).toEqual(
			new Array(0x80).fill(0),
		);
		const table = readHcaAthTable(1, 44100);
		if (!table) throw new Error("no table");
		// The reference stands of the key of the engine twice at every count of the places of the counts of
		// the walk of the engine, once at the count of itself and once at the count of the count of them that
		// stands behind it, so the count of the places of the counts of the walk of the engine stands of the
		// count of the places of the sound of the engine of the counts of the places of the counts of them
		// that stand before it: the first ones stand of the counts of the places of the counts of the walk of
		// the engine of the table of the engine, at the places of the counts of them.
		expect(table[0]).toBe(0x78);
		expect(table[1]).toBe(0x47);
		expect(table[2]).toBe(0x43);
		// The counts of the places of the counts of the walk of the engine stand of the counts of the places
		// of the counts of them that stand behind them, at no place behind the last counts of them: the count
		// of the places of the counts of the walk of the engine of the count of the places of the counts of
		// them that stands at the count of the places of the counts of the walk of the engine of the sound of
		// the engine itself stands of the last places of the counts of them.
		for (const place of table) expect(place).toBeGreaterThanOrEqual(0x3b);
		expect(table[60]).not.toBe(0xff);
		expect([...table.subarray(61)]).toEqual(new Array(0x80 - 61).fill(0xff));
		// A count of the key of the engine behind the counts of the places of the counts of the walk of the
		// engine stands of the counts of the places of the last count of them, at every count of the places
		// of the counts of the walk of the engine of the count of the walk of the engine itself.
		const high = readHcaAthTable(1, 0xffffffff);
		if (!high) throw new Error("no table");
		expect(high[0]).toBe(0x78);
		expect([...high.subarray(1)]).toEqual(new Array(0x7f).fill(0xff));
		// The reference stands of the counts of the walk of the engine of the kind of the table of the counts
		// of the places of a sound of the engine of no count of them at all.
		expect(() => readHcaAthTable(2, 44100)).toThrowError(GarbroError);
	});

	it("stands of the counts of the cipher of a sound of the engine", () => {
		// The counts of the walk of the engine of no cipher at all stand of the places of the counts of the
		// walk of the engine of the places of the picture of the engine itself.
		expect([...(createHcaCipher(0, 1, 2) ?? [])]).toEqual(
			new Array(0x100).fill(0).map((_, at) => at),
		);
		const table = createHcaCipher(1, 1, 2);
		if (!table) throw new Error("no table");
		expect(table[0]).toBe(0);
		expect(table[0xff]).toBe(0xff);
		// The counts of the walk of the engine of the cipher of the engine stand of the counts of the places
		// of the sound of the engine itself, which stand of the counts of the walk of the engine of the counts
		// of them behind them.
		expect(table[1]).toBe(0x0b);
		expect(table[2]).toBe(0x9a);
		expect(table[3]).toBe(0xdd);
		expect(new Set([...table]).size).toBe(0x100);
		// The reference stands of the counts of the walk of the engine of no cipher at all where the key of
		// the engine stands of no counts of it, of every kind of the cipher of it.
		expect([...createHcaCipher(56, 0, 0)]).toEqual(
			new Array(0x100).fill(0).map((_, at) => at),
		);
		// The reference stands of no counts of the walk of the engine of the cipher of the key of the game.
		expect(() => createHcaCipher(56, 0x30dbe1ab, 0xcc554639)).toThrowError(
			GarbroError,
		);
		expect(() => createHcaCipher(7, 1, 2)).toThrowError(GarbroError);
	});

	it("stands of the places of the counts of the walk of the engine of the cipher of it", () => {
		const table = createHcaCipher(1, 1, 2);
		const block = Buffer.from([0, 1, 2, 3, 0xff]);
		decipherHcaBlock(table, block);
		expect([...block]).toEqual([0, 0x0b, 0x9a, 0xdd, 0xff]);
	});

	it("stands of the counts of the table of the places and of the cipher of the head of a sound", async () => {
		const plain = hcaFile({ cipherType: 0 });
		const sound = readHcaSound(plain);
		expect(sound?.layout.cipherType).toBe(0);
		expect(sound?.ath).toHaveLength(0x80);
		expect(await detect(plain)).toBe(true);
		// A sound of the engine of a kind of the cipher of the key of the game stands of no counts of the walk
		// of the engine of its own, so the reference stands of no sound of the engine at all.
		const keyed = hcaFile({ cipherType: 56, chunks: "plain" });
		expect(() => readHcaSound(keyed)).toThrowError(GarbroError);
		expect(await detect(keyed)).toBe(false);
		await expect(
			criHcaAudioFormat.open(new BufferByteSource(keyed), "sound.hca"),
		).rejects.toMatchObject({ code: "UNSUPPORTED_FEATURE" });
		// The counts of the walk of the engine of the table of the places of a sound of the engine stand of
		// the counts of the places of the sound itself, which stand of the counts of the walk of the engine
		// of the kind of one count at the counts of them.
		const unknownAth = hcaFile({ athType: 9, chunks: "plain" });
		expect(() => readHcaSound(unknownAth)).toThrowError(GarbroError);
		expect(await detect(unknownAth)).toBe(false);
	});
});
