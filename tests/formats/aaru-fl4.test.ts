import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { aaruFl4Format } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const HEADER_SIZE = 0x1a;
const RECORD_HEADER_SIZE = 9;
const TERMINATOR = 0xffffffff;

interface EntrySource {
	name: string;
	payload: Buffer;
}

/** Builds the header of a payload that carries a declared unpacked size. */
function buildLzssPayload(
	marker: "PD" | "PD2A",
	stream: Buffer,
	unpackedSize: number,
): Buffer {
	const header = Buffer.alloc(marker === "PD2A" ? 0x10 : 0xa);
	header.write(marker, 0, "latin1");
	header.writeUInt32LE(unpackedSize, marker === "PD2A" ? 0xc : 6);
	return Buffer.concat([header, stream]);
}

/** Builds an RD1.0 payload whose chunk data starts at the offset stored in its own header. */
function buildRlePayload(stream: Buffer, chunks: number): Buffer {
	const header = Buffer.alloc(0x10);
	header.write("RD1.0", 0, "latin1");
	header.writeUInt16LE(header.length, 6);
	header.writeInt32LE(chunks, 0xa);
	return Buffer.concat([header, stream]);
}

function buildFl4(sources: readonly EntrySource[]): Buffer {
	const dataOffset = HEADER_SIZE;
	const records: Buffer[] = [];
	const payloads: Buffer[] = [];
	let payloadCursor = dataOffset;
	for (const source of sources) {
		const name = Buffer.from(encodeCp932(source.name));
		const record = Buffer.alloc(RECORD_HEADER_SIZE + name.length);
		record.writeUInt32LE(payloadCursor - dataOffset, 0);
		record.writeUInt32LE(source.payload.length, 4);
		record.writeUInt8(name.length, 8);
		name.copy(record, RECORD_HEADER_SIZE);
		records.push(record);
		payloads.push(source.payload);
		payloadCursor += source.payload.length;
	}
	const terminator = Buffer.alloc(RECORD_HEADER_SIZE);
	terminator.writeUInt32LE(TERMINATOR, 0);
	const payloadBlock = Buffer.concat(payloads);
	// The index opens with the position of its first record.
	const first = Buffer.alloc(4);
	first.writeInt32LE(4, 0);
	const index = Buffer.concat([first, ...records, terminator]);
	const header = Buffer.alloc(HEADER_SIZE);
	header.write("FL4.0", 0, "latin1");
	header.writeUInt16LE(dataOffset, 8);
	header.writeUInt32LE(index.length, 0xa);
	header.writeUInt32LE(HEADER_SIZE + payloadBlock.length, 0xe);
	return Buffer.concat([header, payloadBlock, index]);
}

async function expectDeclined(file: Buffer): Promise<void> {
	const source = new BufferByteSource(file);
	expect(await aaruFl4Format.detect(source, "sample.dat")).toBe(false);
}

describe("Aaru FL4 resource archive", () => {
	it("lists stored entries", async () => {
		const first = Buffer.from("stored payload");
		const second = Buffer.from("another payload");
		await expectArchive({
			format: aaruFl4Format,
			sourcePath: "sample.dat",
			archive: buildFl4([
				{ name: "first.dat", payload: first },
				{ name: "second.dat", payload: second },
			]),
			entries: [
				{ path: "first.dat", size: first.length, content: first },
				{ path: "second.dat", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("unpacks a PD payload", async () => {
		const data = Buffer.from("pd payload");
		const payload = buildLzssPayload(
			"PD",
			literalLzssStream(data),
			data.length,
		);
		await expectArchive({
			format: aaruFl4Format,
			sourcePath: "sample.dat",
			archive: buildFl4([{ name: "packed.dat", payload }]),
			entries: [{ path: "packed.dat", size: data.length, content: data }],
		});
	});

	it("unpacks a PD2A payload", async () => {
		const data = Buffer.from("pd2a payload");
		const payload = buildLzssPayload(
			"PD2A",
			literalLzssStream(data),
			data.length,
		);
		await expectArchive({
			format: aaruFl4Format,
			sourcePath: "sample.dat",
			archive: buildFl4([{ name: "packed.dat", payload }]),
			entries: [{ path: "packed.dat", size: data.length, content: data }],
		});
	});

	it("unpacks an RD1.0 payload", async () => {
		// Three chunks: three raw bytes, a two byte repeat and a four byte repeat with a sixteen bit count.
		const stream = Buffer.concat([
			Buffer.from([0x00, 0x03]),
			Buffer.from("abc"),
			Buffer.from([0x02, 0x5a]),
			Buffer.from([0x03, 0x04, 0x00, 0x21]),
		]);
		const payload = buildRlePayload(stream, 3);
		await expectArchive({
			format: aaruFl4Format,
			sourcePath: "sample.dat",
			archive: buildFl4([{ name: "rle.dat", payload }]),
			entries: [
				{
					path: "rle.dat",
					size: payload.length,
					content: Buffer.from("abcZZ!!!!"),
				},
			],
		});
	});

	it("reports an RLE entry with an unknown size", async () => {
		const stream = Buffer.from([0x01, 0x41]);
		const payload = buildRlePayload(stream, 1);
		const archive = await aaruFl4Format.open(
			new BufferByteSource(buildFl4([{ name: "rle.dat", payload }])),
			"sample.dat",
		);
		expect(archive.entries[0]).toMatchObject({
			compressed: true,
			sizeKnown: false,
		});
	});

	it("keeps a payload without a known marker stored", async () => {
		const payload = Buffer.from("plain payload bytes");
		await expectArchive({
			format: aaruFl4Format,
			sourcePath: "sample.dat",
			archive: buildFl4([{ name: "plain.dat", payload }]),
			entries: [{ path: "plain.dat", size: payload.length, content: payload }],
		});
	});

	it("rejects a file without the version byte", async () => {
		const file = buildFl4([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.writeUInt8(0x31, 4);
		await expectDeclined(file);
	});

	it("rejects an index that leaves the file", async () => {
		const file = buildFl4([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.writeUInt32LE(file.length * 4, 0xa);
		await expectDeclined(file);
	});

	it("rejects an entry that leaves the file", async () => {
		const file = buildFl4([{ name: "first.dat", payload: Buffer.from("x") }]);
		const indexOffset = file.readUInt32LE(0xe);
		file.writeUInt32LE(file.length * 4, indexOffset + 4 + 4);
		await expectDeclined(file);
	});
});
