import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { emonEmeFormat } from "../../packages/formats/src/emon/eme.js";
import { literalLzssStream } from "../helpers/lzss.js";

const INDEX_RECORD_SIZE = 0x60;
const KEY_SIZE = 40;

/** The identity key: every step carries opcode 0, so records are stored verbatim. */
const IDENTITY_KEY = Buffer.alloc(KEY_SIZE);

/** A key whose only step XORs every word of the record with the last key word. */
function xorKey(word: number): Buffer {
	const key = Buffer.alloc(KEY_SIZE);
	key[7] = 1;
	key.writeUInt32LE(word, 36);
	return key;
}

/** Applies the opcode 1 step, which is its own inverse. */
function xorWords(data: Buffer, word: number): Buffer {
	const output = Buffer.from(data);
	for (let offset = 0; offset + 4 <= output.length; offset += 4)
		output.writeUInt32LE((output.readUInt32LE(offset) ^ word) >>> 0, offset);
	return output;
}

interface EmeFixtureEntry {
	name: string;
	data: Buffer;
	subType?: number;
	frameSize?: number;
	frameInitPos?: number;
	/** Stored size; defaults to the payload length. */
	size?: number;
	/** Declared unpacked size; defaults to the stored size. */
	unpackedSize?: number;
}

interface EmeFixture {
	archive: Buffer;
	key: Buffer;
	offsets: number[];
}

/**
 * Builds an EME archive: entry payloads, the decrypt key, the encrypted index records and the count.
 * The key has to be transformed with the same routine the records are encrypted with.
 */
function buildEme(
	entries: EmeFixtureEntry[],
	key: Buffer = IDENTITY_KEY,
	transform: (data: Buffer) => Buffer = (data) => Buffer.from(data),
): EmeFixture {
	const payloads: Buffer[] = [];
	let offset = 8;
	const offsets: number[] = [];
	for (const entry of entries) {
		payloads.push(Buffer.from(entry.data));
		offsets.push(offset);
		offset += entry.data.length;
	}
	const index = Buffer.alloc(entries.length * INDEX_RECORD_SIZE);
	for (const [i, entry] of entries.entries()) {
		const position = i * INDEX_RECORD_SIZE;
		index.write(entry.name, position, "latin1");
		index.writeUInt16LE(entry.frameSize ?? 0, position + 0x40);
		index.writeUInt16LE(entry.frameInitPos ?? 0, position + 0x42);
		index.writeInt32LE(entry.subType ?? 1, position + 0x48);
		const size = entry.size ?? entry.data.length;
		index.writeUInt32LE(size, position + 0x4c);
		index.writeUInt32LE(entry.unpackedSize ?? size, position + 0x50);
		index.writeUInt32LE(offsets[i] ?? 0, position + 0x54);
	}
	const records = transform(index);
	const count = Buffer.alloc(4);
	count.writeInt32LE(entries.length, 0);
	return {
		archive: Buffer.concat([
			Buffer.from("RREDATA ", "latin1"),
			...payloads,
			key,
			records,
			count,
		]),
		key,
		offsets,
	};
}

function sourceOf(archive: Buffer): BufferByteSource {
	return new BufferByteSource(archive);
}

describe("emon engine archive", () => {
	it("declines a file with the wrong signature", async () => {
		const { archive } = buildEme([{ name: "A.BIN", data: Buffer.from("x") }]);
		archive.write("NOREDATA", 0, "latin1");
		expect(await emonEmeFormat.detect(sourceOf(archive), "game.eme")).toBe(
			false,
		);
	});

	it("declines an insane entry count", async () => {
		const { archive } = buildEme([{ name: "A.BIN", data: Buffer.from("x") }]);
		archive.writeInt32LE(0x20000, archive.length - 4);
		expect(await emonEmeFormat.detect(sourceOf(archive), "game.eme")).toBe(
			false,
		);
	});

	it("declines an entry that leaves the archive", async () => {
		const { archive } = buildEme([{ name: "A.BIN", data: Buffer.from("x") }]);
		archive.writeUInt32LE(
			0x1000,
			archive.length - 4 - INDEX_RECORD_SIZE + 0x4c,
		);
		expect(await emonEmeFormat.detect(sourceOf(archive), "game.eme")).toBe(
			false,
		);
	});

	it("lists plainly stored entries and extracts them verbatim", async () => {
		const first = Buffer.from("plain body");
		const second = Buffer.from([1, 2, 3, 4]);
		const { archive } = buildEme([
			{ name: "DATA.BIN", data: first, subType: 1 },
			{ name: "MORE.BIN", data: second, subType: 0 },
		]);
		const opened = await emonEmeFormat.open(sourceOf(archive), "game.eme");
		try {
			expect(opened.entries.map((entry) => entry.path)).toEqual([
				"DATA.BIN",
				"MORE.BIN",
			]);
			expect(opened.entries.map((entry) => Number(entry.size))).toEqual([
				first.length,
				second.length,
			]);
			expect(opened.entries.every((entry) => entry.sizeKnown !== false)).toBe(
				true,
			);
			expect(opened.entries.every((entry) => entry.encrypted === true)).toBe(
				true,
			);
			const entry = opened.entries[1];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await opened.openEntry(entry.id))).toEqual(
				second,
			);
		} finally {
			await opened.close();
		}
	});

	it("marks image entries with their type", async () => {
		const { archive } = buildEme([
			{ name: "PIC.BMP", data: Buffer.from("image bytes"), subType: 4 },
		]);
		const opened = await emonEmeFormat.open(sourceOf(archive), "game.eme");
		try {
			expect(opened.entries[0]?.metadata).toMatchObject({ type: "image" });
		} finally {
			await opened.close();
		}
	});

	it("decrypts the index with a single xor step", async () => {
		const word = 0x1234abcd;
		const data = Buffer.from("encrypted payload");
		const { archive } = buildEme(
			[{ name: "XOR.BIN", data, subType: 1 }],
			xorKey(word),
			(buffer) => xorWords(buffer, word),
		);
		const opened = await emonEmeFormat.open(sourceOf(archive), "game.eme");
		try {
			expect(opened.entries[0]?.path).toBe("XOR.BIN");
			const entry = opened.entries[0];
			if (!entry) throw new Error("missing entry");
			// The payload is stored verbatim, only the index is encrypted.
			expect(await consumeBuffer(await opened.openEntry(entry.id))).toEqual(
				data,
			);
		} finally {
			await opened.close();
		}
	});

	it("decrypts a script header with a single xor step", async () => {
		const word = 0x0f0f0f0f;
		const header = Buffer.alloc(12);
		header.writeUInt32LE(0, 0);
		header.writeInt32LE(0, 4);
		const body = Buffer.from("script text");
		const { archive } = buildEme(
			[
				{
					name: "A.SCR",
					data: Buffer.concat([xorWords(header, word), body]),
					subType: 3,
				},
			],
			xorKey(word),
			(buffer) => xorWords(buffer, word),
		);
		const opened = await emonEmeFormat.open(sourceOf(archive), "game.eme");
		try {
			const entry = opened.entries[0];
			if (!entry) throw new Error("missing entry");
			// A zero frame size means the decrypted header is prefixed to the raw payload. The reference
			// reads the stored size from behind the header, so trailing bytes are included.
			const output = await consumeBuffer(await opened.openEntry(entry.id));
			expect(output.subarray(0, 12)).toEqual(header);
			expect(output.subarray(12, 12 + body.length)).toEqual(body);
		} finally {
			await opened.close();
		}
	});

	it("reports scripts as unknown length with the header size added", async () => {
		const header = Buffer.alloc(12);
		const body = Buffer.from("body");
		const { archive } = buildEme([
			{
				name: "A.SCR",
				data: Buffer.concat([header, body]),
				subType: 3,
				size: 12 + body.length,
				unpackedSize: body.length,
			},
		]);
		const opened = await emonEmeFormat.open(sourceOf(archive), "game.eme");
		try {
			const entry = opened.entries[0];
			// Without frames the header is prefixed to a read of the stored size.
			expect(entry?.size).toBe(BigInt(12 + 12 + body.length));
			expect(entry?.sizeKnown).toBe(false);
			expect(entry?.metadata).toMatchObject({ type: "script" });
		} finally {
			await opened.close();
		}
	});

	it("decodes a two part script stream", async () => {
		const frameSize = 0x10;
		const headPlain = Buffer.from("first part");
		const tailPlain = Buffer.from("second part");
		// The head stream decodes the trailing part, the tail stream the leading part.
		const head = literalLzssStream(tailPlain);
		const tail = literalLzssStream(headPlain);
		const header = Buffer.alloc(12);
		header.writeUInt32LE(head.length, 0);
		header.writeInt32LE(tailPlain.length, 4);
		const { archive } = buildEme([
			{
				name: "PART.SCR",
				data: Buffer.concat([header, head, tail]),
				subType: 3,
				size: 12 + head.length + tail.length,
				unpackedSize: headPlain.length + tailPlain.length,
				frameSize,
				frameInitPos: 0x10,
			},
		]);
		const opened = await emonEmeFormat.open(sourceOf(archive), "game.eme");
		try {
			const entry = opened.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.sizeKnown).toBe(false);
			expect(await consumeBuffer(await opened.openEntry(entry.id))).toEqual(
				Buffer.concat([headPlain, tailPlain]),
			);
		} finally {
			await opened.close();
		}
	});

	it("prepends the four byte header of a type five entry", async () => {
		const header = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);
		const body = Buffer.from("rest of payload");
		const { archive } = buildEme([
			{ name: "FIVE.BIN", data: Buffer.concat([header, body]), subType: 5 },
		]);
		const opened = await emonEmeFormat.open(sourceOf(archive), "game.eme");
		try {
			const entry = opened.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(Number(entry.size)).toBe(header.length + body.length);
			expect(await consumeBuffer(await opened.openEntry(entry.id))).toEqual(
				Buffer.concat([header, body]),
			);
		} finally {
			await opened.close();
		}
	});

	it("reads a script whose stream runs to the end of the input", async () => {
		const body = Buffer.from("literal payload bytes");
		const header = Buffer.alloc(12);
		header.writeUInt32LE(0, 0);
		header.writeInt32LE(0, 4);
		const { archive } = buildEme([
			{
				name: "FREE.SCR",
				data: Buffer.concat([header, literalLzssStream(body)]),
				subType: 3,
				size: 12 + literalLzssStream(body).length,
				unpackedSize: literalLzssStream(body).length,
				frameSize: 0x10,
				frameInitPos: 0x10,
			},
		]);
		const opened = await emonEmeFormat.open(sourceOf(archive), "game.eme");
		try {
			const entry = opened.entries[0];
			if (!entry) throw new Error("missing entry");
			// The reference decodes everything it read, including bytes trailing the stream.
			const output = await consumeBuffer(await opened.openEntry(entry.id));
			expect(output.subarray(0, body.length)).toEqual(body);
		} finally {
			await opened.close();
		}
	});
});

// Golden values produced by an independent Python transcription of `EmeOpener.Decrypt` and
// `EmeOpener.ShiftValue`, for a key whose only step spreads the bits of every word by five.
const GOLDEN_KEY = Buffer.from(
	"00000000000000040000000000000000000000000000000000000000000000000000000005000000",
	"hex",
);
const GOLDEN_INDEX = Buffer.from(
	"3ae190b00030080000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800080000000000001000800100000001000000000008000000000000000000",
	"hex",
);

describe("emon engine bit spreading step", () => {
	it("decrypts an index record produced outside the port", async () => {
		const count = Buffer.alloc(4);
		count.writeInt32LE(1, 0);
		const archive = Buffer.concat([
			Buffer.from("RREDATA ", "latin1"),
			Buffer.alloc(0x30), // the script payload: a zero header and a zero frame size
			GOLDEN_KEY,
			GOLDEN_INDEX,
			count,
		]);
		expect(GOLDEN_INDEX.length).toBe(INDEX_RECORD_SIZE);
		const opened = await emonEmeFormat.open(sourceOf(archive), "game.eme");
		try {
			const entry = opened.entries[0];
			expect(entry?.path).toBe("A.SCR");
			expect(entry?.size).toBe(0x20n);
			expect(entry?.metadata).toMatchObject({
				type: "script",
				frameSize: 0x10,
				unpackedSize: 0x20,
			});
		} finally {
			await opened.close();
		}
	});
});
