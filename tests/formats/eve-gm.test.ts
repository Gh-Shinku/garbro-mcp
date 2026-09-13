import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { eveGmFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const ENTRY_HEADER_SIZE = 25;
const STREAM_OFFSET_IN_HEADER = 10;
const UNPACKED_SIZE_FIELD = 6;
const RECORD_BIAS = 0xc00;
const INDEX_OFFSET = 0x40;
const DATA_OFFSET = 0x100;
const SWAP_FIELDS: readonly [number, number][] = [
	[17, 23],
	[19, 24],
];

/** Builds the payload header of an entry whose body is an LZSS stream starting inside the header. */
function buildCompressed(payload: Buffer, type: "B" | "E"): Buffer {
	const stream = literalLzssStream(payload);
	const body = Buffer.alloc(ENTRY_HEADER_SIZE);
	body[0] = type.charCodeAt(0);
	body[1] = 0x31;
	body.writeInt32LE(payload.length, UNPACKED_SIZE_FIELD);
	stream.copy(
		body,
		STREAM_OFFSET_IN_HEADER,
		0,
		ENTRY_HEADER_SIZE - STREAM_OFFSET_IN_HEADER,
	);
	if (type === "E") {
		// The reader swaps these pairs before it decodes, so the stored bytes are swapped here.
		for (const [left, right] of SWAP_FIELDS) {
			const temporary = body[left] ?? 0;
			body[left] = body[right] ?? 0;
			body[right] = temporary;
		}
	}
	return Buffer.concat([
		body,
		stream.subarray(ENTRY_HEADER_SIZE - STREAM_OFFSET_IN_HEADER),
	]);
}

/** Builds a BPR run length stream: a repeated byte, a copied run and the terminator. */
function buildBpr(): Buffer {
	const repeated = Buffer.alloc(6);
	repeated.writeUInt8(1, 0);
	repeated.writeInt32LE(5, 1);
	repeated.writeUInt8(0x78, 5);
	const copied = Buffer.alloc(5);
	copied.writeUInt8(2, 0);
	copied.writeInt32LE(3, 1);
	return Buffer.concat([
		repeated,
		copied,
		Buffer.from("abc"),
		Buffer.from([0xff]),
	]);
}

interface GmSource {
	name: string;
	payload: Buffer;
}

function buildGm(sources: readonly GmSource[]): Buffer {
	const version = Buffer.from("GM1.0\0", "latin1");
	const headerOffset = ((version.length + 4) >> 2) << 2;
	const head = Buffer.alloc(headerOffset + 18);
	version.copy(head, 0);
	head.writeUInt16LE(DATA_OFFSET, headerOffset);
	head.writeUInt32LE(0, headerOffset + 2);
	head.writeUInt32LE(INDEX_OFFSET, headerOffset + 6);
	head.writeInt32LE(sources.length, headerOffset + 10);
	const file = Buffer.alloc(
		DATA_OFFSET +
			sources.reduce((total, source) => total + source.payload.length, 0),
	);
	head.copy(file, 0);
	let cursor = DATA_OFFSET;
	const records: Buffer[] = [];
	for (const source of sources) {
		const name = Buffer.from(encodeCp932(source.name));
		source.payload.copy(file, cursor);
		const record = Buffer.alloc(9 + name.length);
		record.writeUInt32LE(cursor - DATA_OFFSET, 0);
		record.writeUInt32LE(source.payload.length, 4);
		record.writeUInt8(name.length, 8);
		name.copy(record, 9);
		records.push(record);
		cursor += source.payload.length;
	}
	const index = Buffer.concat(records);
	const output = Buffer.concat([
		file,
		Buffer.alloc(INDEX_OFFSET + RECORD_BIAS - file.length),
		index,
	]);
	return output;
}

async function expectDeclined(file: Buffer): Promise<void> {
	const source = new BufferByteSource(file);
	expect(await eveGmFormat.detect(source, "sample.dat")).toBe(false);
}

describe("Eve resource archive", () => {
	it("lists entries with shift-jis names", async () => {
		const payload = Buffer.from("plain payload");
		await expectArchive({
			format: eveGmFormat,
			sourcePath: "sample.dat",
			archive: buildGm([{ name: "データ.bin", payload }]),
			entries: [{ path: "データ.bin", size: payload.length, content: payload }],
			metadata: { entryCount: 1 },
		});
	});

	it("hands out an uncompressed payload as it is stored", async () => {
		const payload = Buffer.from("not compressed at all");
		await expectArchive({
			format: eveGmFormat,
			sourcePath: "sample.dat",
			archive: buildGm([{ name: "raw.bin", payload }]),
			entries: [{ path: "raw.bin", size: payload.length, content: payload }],
		});
	});

	it("unpacks a compressed payload", async () => {
		const payload = Buffer.from("compressed payload");
		const stored = buildCompressed(payload, "B");
		await expectArchive({
			format: eveGmFormat,
			sourcePath: "sample.dat",
			archive: buildGm([{ name: "packed.bin", payload: stored }]),
			entries: [{ path: "packed.bin", size: stored.length, content: payload }],
		});
	});

	it("swaps the pairs of an E payload before unpacking", async () => {
		const payload = Buffer.from("e payload with swapped words");
		const stored = buildCompressed(payload, "E");
		await expectArchive({
			format: eveGmFormat,
			sourcePath: "sample.dat",
			archive: buildGm([{ name: "swapped.bin", payload: stored }]),
			entries: [{ path: "swapped.bin", size: stored.length, content: payload }],
		});
	});

	it("runs a second pass over a payload that carries the BPR marker", async () => {
		const inner = Buffer.concat([Buffer.from("BPR01"), buildBpr()]);
		const stored = buildCompressed(inner, "B");
		await expectArchive({
			format: eveGmFormat,
			sourcePath: "sample.dat",
			archive: buildGm([{ name: "double.bin", payload: stored }]),
			entries: [
				{
					path: "double.bin",
					size: stored.length,
					content: Buffer.from("xxxxxabc"),
				},
			],
		});
	});

	it("rejects a file without the version byte", async () => {
		const file = buildGm([
			{ name: "raw.bin", payload: Buffer.from("payload") },
		]);
		file.writeUInt8(0x31, 4);
		await expectDeclined(file);
	});

	it("rejects a file without entries", async () => {
		const file = buildGm([
			{ name: "raw.bin", payload: Buffer.from("payload") },
		]);
		const headerOffset = 8;
		file.writeInt32LE(0, headerOffset + 10);
		await expectDeclined(file);
	});

	it("rejects an entry that leaves the file", async () => {
		const file = buildGm([
			{ name: "raw.bin", payload: Buffer.from("payload") },
		]);
		const records = INDEX_OFFSET + RECORD_BIAS;
		file.writeUInt32LE(file.length * 4, records + 4);
		await expectDeclined(file);
	});
});
