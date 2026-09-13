import { encodeCp932 } from "@garbro-mcp/core";
import { ddp2Format, ddp3Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const SIZE_PAIR = 8;

/** A literal of one byte and then a match at distance one: the run repeats that byte five times. */
const PACKED_STREAM = Buffer.from([0x00, 0x41, 0x22]);
const PACKED_EXPANDED = Buffer.from("AAAAAA");

/** Both versions store a stored size and an unpacked size ahead of the data itself. */
function payload(data: Buffer, packed: boolean): Buffer {
	const header = Buffer.alloc(SIZE_PAIR);
	header.writeUInt32LE(packed ? data.length : 0, 0);
	header.writeUInt32LE(packed ? PACKED_EXPANDED.length : data.length, 4);
	return Buffer.concat([header, data]);
}

/** Version two: sixteen-byte records at 0x20 holding an offset and two size hints. */
function buildDdp2(payloads: readonly Buffer[]): Buffer {
	const indexOffset = 0x20;
	const indexSize = payloads.length * 0x10;
	const dataOffset = indexOffset + indexSize;
	const archive = Buffer.alloc(
		dataOffset + payloads.reduce((sum, item) => sum + item.length, 0),
	);
	archive.write("DDP2", 0, "ascii");
	archive.writeInt32LE(payloads.length, 4);
	let position = dataOffset;
	for (const [id, item] of payloads.entries()) {
		const record = indexOffset + id * 0x10;
		archive.writeUInt32LE(position, record);
		// The hints are only shadows of the payload's own pair.
		archive.writeUInt32LE(0, record + 4);
		archive.writeUInt32LE(item.length, record + 8);
		item.copy(archive, position);
		position += item.length;
	}
	return archive;
}

/** Version three: section descriptors at 0x20, then section entries with their own names. */
function buildDdp3(
	entries: readonly { name: string; payload: Buffer }[],
): Buffer {
	const sectionOffset = 0x20 + 8;
	const sectionSize = entries.reduce(
		(sum, entry) => sum + 17 + encodeCp932(entry.name).length,
		0,
	);
	const dataOffset = sectionOffset + sectionSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.payload.length, 0),
	);
	archive.write("DDP3", 0, "ascii");
	archive.writeInt32LE(1, 4);
	archive.writeInt32LE(sectionSize, 0x20);
	archive.writeInt32LE(sectionOffset, 0x24);
	let position = sectionOffset;
	let data = dataOffset;
	for (const entry of entries) {
		const name = encodeCp932(entry.name);
		const entrySize = 17 + name.length;
		archive.writeUInt8(entrySize, position);
		archive.writeUInt32LE(data, position + 1);
		archive.writeUInt32LE(0, position + 5);
		archive.writeUInt32LE(entry.payload.length, position + 9);
		name.copy(archive, position + 17);
		entry.payload.copy(archive, data);
		position += entrySize;
		data += entry.payload.length;
	}
	return archive;
}

describe("DDSystem DDP resource archives", () => {
	it("reads version two with a plain and a compressed payload", async () => {
		const plain = Buffer.from("plain body");
		const archive = buildDdp2([
			payload(plain, false),
			payload(PACKED_STREAM, true),
		]);
		await expectArchive({
			format: ddp2Format,
			archive,
			sourcePath: "sample.dat",
			entries: [
				{ path: "sample#00000", size: plain.length, content: plain },
				{
					path: "sample#00001",
					size: PACKED_EXPANDED.length,
					content: PACKED_EXPANDED,
				},
			],
		});
	});

	it("reads version three through its section walk", async () => {
		const plain = Buffer.from("section body");
		const archive = buildDdp3([
			{ name: "one.dat", payload: payload(plain, false) },
			{ name: "two.dat", payload: payload(PACKED_STREAM, true) },
		]);
		await expectArchive({
			format: ddp3Format,
			archive,
			sourcePath: "sample.dat",
			entries: [
				{ path: "one.dat", size: plain.length, content: plain },
				{
					path: "two.dat",
					size: PACKED_EXPANDED.length,
					content: PACKED_EXPANDED,
				},
			],
		});
	});

	it("rejects the sibling signature in both directions", async () => {
		const plain = Buffer.from("body");
		await expectArchive({
			format: ddp2Format,
			archive: buildDdp3([{ name: "one.dat", payload: payload(plain, false) }]),
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
		await expectArchive({
			format: ddp3Format,
			archive: buildDdp2([payload(plain, false)]),
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});

	it("rejects a payload whose sizes do not describe the file", async () => {
		const archive = buildDdp2([payload(Buffer.from("body"), false)]);
		// The payload's unpacked size sits behind its stored size, and the payload starts behind the index.
		archive.writeUInt32LE(0x1000, 0x20 + 0x10 + 4);
		await expectArchive({
			format: ddp2Format,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});
});
