import { vcPakFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_KEY = 0x58;
const DATA_KEY = 0x24;
const COUNT_OFFSET = 0x18;
const INDEX_SIZE_OFFSET = 0x1c;
const INDEX_OFFSET = 0x20;
const RECORD_SIZE = 0x10;
const CPS_SIZE_XOR = 0x0a415fcf;

const SIGNATURE = Buffer.from([
	0x82, 0x76, 0x82, 0x62, 0x90, 0xbb, 0x95, 0x69, 0x94, 0xc5,
]);

/** Packs values least-significant-bit first, the order the format's own reader consumes. */
class LsbBitWriter {
	readonly bits: number[] = [];
	write(value: number, count: number): void {
		for (let index = 0; index < count; index += 1)
			this.bits.push((value >> index) & 1);
	}
	toBuffer(): Buffer {
		const output = Buffer.alloc(Math.ceil(this.bits.length / 8));
		for (const [index, bit] of this.bits.entries())
			if (bit !== 0)
				output[Math.floor(index / 8)] =
					(output[Math.floor(index / 8)] ?? 0) | (1 << (index % 8));
		return output;
	}
}

/** A `.cps` header packs the output length and the layout nibble into one masked word. */
function cpsPayload(type: number, unpackedSize: number, body: Buffer): Buffer {
	const header = Buffer.alloc(4);
	header.writeUInt32LE(((unpackedSize ^ CPS_SIZE_XOR) >>> 0) & 0x0fffffff, 0);
	header[3] = ((header[3] ?? 0) & 0x0f) | (type << 4);
	return Buffer.concat([header, body]);
}

/** Version one: a four-bit count, then one bit choosing literal bytes over a repeated one. */
function cpsV1(body: Buffer): Buffer {
	return cpsPayload(1, 2, body);
}

/** Version three stores outputs of at most 128 bytes whole behind the header. */
function cpsV3(output: Buffer): Buffer {
	return cpsPayload(3, output.length, output);
}

/** Version two seeds its last output byte from the payload and fills pairs from a bit stream. */
function cpsV2(low: number, high: number): Buffer {
	const body = Buffer.alloc(38 - 4 + 4);
	body[36 - 4] = 0x7f;
	const writer = new LsbBitWriter();
	writer.write(1, 1);
	writer.write(high, 8);
	writer.write(low, 8);
	const stream = writer.toBuffer();
	stream.copy(body, 38 - 4);
	return cpsPayload(2, 2, body);
}

interface Entry {
	name: string;
	/** The plaintext the archive should yield after its own key and any expansion. */
	plain: Buffer;
	/** The bytes stored in the archive, already keyed. */
	stored: Buffer;
}

/** Applies the payload key, and the inverse of a script's decrement. */
function keyed(plain: Buffer, script: boolean): Buffer {
	const output = Buffer.from(plain);
	for (let index = 0; index < output.length; index += 1) {
		const value = script
			? ((output[index] ?? 0) + 1) & 0xff
			: (output[index] ?? 0);
		output[index] = value ^ DATA_KEY;
	}
	return output;
}

function buildPak(entries: readonly Entry[]): Buffer {
	const records = Buffer.alloc(RECORD_SIZE * entries.length);
	// The names begin one record stride per entry in, which puts them right behind the last record's fields.
	const namesOffset = entries.length * RECORD_SIZE;
	const names = Buffer.concat(
		entries.map((entry) =>
			Buffer.concat([Buffer.from(entry.name, "latin1"), Buffer.from([0])]),
		),
	);
	let dataOffset =
		INDEX_OFFSET + Math.max(4 + records.length, namesOffset + names.length);
	const payloads = entries.map((entry) => entry.stored);
	const starts: number[] = [];
	for (const payload of payloads) {
		starts.push(dataOffset);
		dataOffset += payload.length;
	}
	const indexSize = Math.max(4 + records.length, namesOffset + names.length);
	const archive = Buffer.alloc(
		INDEX_OFFSET +
			indexSize +
			payloads.reduce((sum, item) => sum + item.length, 0),
	);
	SIGNATURE.copy(archive, 0);
	const wordKey = ((INDEX_KEY << 8) | INDEX_KEY) >>> 0;
	const mask = (wordKey | (wordKey << 16)) >>> 0;
	archive.writeUInt32LE((entries.length ^ mask) >>> 0, COUNT_OFFSET);
	archive.writeUInt32LE((indexSize ^ mask) >>> 0, INDEX_SIZE_OFFSET);
	const index = Buffer.alloc(indexSize);
	for (const [id, entry] of entries.entries()) {
		// The records start behind the index's own first word, and the names begin one stride per entry in.
		index.writeInt32LE(entry.name.length, 4 + id * RECORD_SIZE);
		index.writeUInt32LE(starts[id] ?? 0, 4 + id * RECORD_SIZE + 4);
		index.writeUInt32LE(entry.stored.length, 4 + id * RECORD_SIZE + 8);
	}
	names.copy(index, namesOffset);
	for (let position = 0; position < index.length; position += 1)
		index[position] = (index[position] ?? 0) ^ INDEX_KEY;
	index.copy(archive, INDEX_OFFSET);
	let data = INDEX_OFFSET + indexSize;
	for (const payload of payloads) {
		payload.copy(archive, data);
		data += payload.length;
	}
	return archive;
}

describe("Valkyrie Complex PAK archive", () => {
	it("reads a script entry with the decrement and an image entry with a stored payload", async () => {
		const script = Buffer.from("script body");
		const image = Buffer.from("image body");
		await expectArchive({
			format: vcPakFormat,
			archive: buildPak([
				{ name: "one.cs", plain: script, stored: keyed(script, true) },
				{ name: "two.cps", plain: image, stored: keyed(cpsV3(image), false) },
			]),
			sourcePath: "sample.pak",
			entries: [
				{ path: "one.cs", size: script.length, content: script },
				// A `.cps` entry reports its stored span while extracting its expanded output.
				{
					path: "two.cps",
					size: keyed(cpsV3(image), false).length,
					content: image,
				},
			],
		});
	});

	it("decodes the version one layout", async () => {
		const writer = new LsbBitWriter();
		writer.write(0, 4);
		writer.write(1, 1);
		writer.write(0x41, 8);
		writer.write(1, 4);
		writer.write(0, 1);
		writer.write(0x42, 8);
		const expected = Buffer.from("AB");
		await expectArchive({
			format: vcPakFormat,
			archive: buildPak([
				{
					name: "one.cps",
					plain: expected,
					stored: keyed(cpsV1(writer.toBuffer()), false),
				},
			]),
			sourcePath: "sample.pak",
			entries: [
				{
					path: "one.cps",
					size: keyed(cpsV1(writer.toBuffer()), false).length,
					content: expected,
				},
			],
		});
	});

	it("decodes the version two layout", async () => {
		const expected = Buffer.from([0x41, 0x42]);
		await expectArchive({
			format: vcPakFormat,
			archive: buildPak([
				{
					name: "two.cps",
					plain: expected,
					stored: keyed(cpsV2(0x41, 0x42), false),
				},
			]),
			sourcePath: "sample.pak",
			entries: [
				{
					path: "two.cps",
					size: keyed(cpsV2(0x41, 0x42), false).length,
					content: expected,
				},
			],
		});
	});

	it("ends an unknown payload layout verbatim", async () => {
		// A type nibble above three leaves the payload alone, header included.
		const payload = Buffer.alloc(8, 0x5a);
		payload[3] = 0x50;
		await expectArchive({
			format: vcPakFormat,
			archive: buildPak([
				{ name: "odd.cps", plain: payload, stored: keyed(payload, false) },
			]),
			sourcePath: "sample.pak",
			entries: [{ path: "odd.cps", size: payload.length, content: payload }],
		});
	});

	it("rejects a foreign signature", async () => {
		const archive = buildPak([
			{
				name: "one.cs",
				plain: Buffer.from("x"),
				stored: keyed(Buffer.from("x"), true),
			},
		]);
		archive.write("XX", 0, "latin1");
		await expectArchive({
			format: vcPakFormat,
			archive,
			sourcePath: "sample.pak",
			detected: false,
			entries: [],
		});
	});

	it("requires the pak extension", async () => {
		const archive = buildPak([
			{
				name: "one.cs",
				plain: Buffer.from("x"),
				stored: keyed(Buffer.from("x"), true),
			},
		]);
		await expectArchive({
			format: vcPakFormat,
			archive,
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});
});
