import { encodeCp932 } from "@garbro-mcp/core";
import { him4Format, him5Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const SIZE_PAIR = 8;

/** A literal of one byte followed by a match at distance one: the run repeats that byte five times. */
const PACKED_STREAM = Buffer.from([0x00, 0x41, 0x22]);
const PACKED_EXPANDED = Buffer.from("AAAAAA");

/** Wraps a payload with the stored and unpacked sizes that both versions read first. */
function payload(data: Buffer, packed: boolean): Buffer {
	const header = Buffer.alloc(SIZE_PAIR);
	header.writeUInt32LE(packed ? data.length : 0, 0);
	header.writeUInt32LE(packed ? PACKED_EXPANDED.length : data.length, 4);
	return Buffer.concat([header, data]);
}

/** Version four: a count, the first offset, then an index of the later offsets only. */
function buildHim4(payloads: readonly Buffer[]): Buffer {
	const indexOffset = 0xc;
	const indexSize = payloads.length * 4;
	const firstOffset = indexOffset + indexSize;
	const archive = Buffer.alloc(
		firstOffset + payloads.reduce((sum, item) => sum + item.length, 0),
	);
	archive.write("Him4", 0, "ascii");
	archive.writeInt32LE(payloads.length, 4);
	archive.writeUInt32LE(firstOffset, 8);
	let position = firstOffset;
	for (const [id, item] of payloads.entries()) {
		if (id > 0) archive.writeUInt32LE(position, indexOffset + (id - 1) * 4);
		item.copy(archive, position);
		position += item.length;
	}
	return archive;
}

/** Version five: eight-byte section descriptors, then section entries with big-endian offsets. */
function buildHim5(
	entries: readonly { name: string; offset: number }[],
	sectionSize: number,
): Buffer {
	const sectionOffset = 8 + 8;
	const archive = Buffer.alloc(sectionOffset + sectionSize);
	archive.write("Him5", 0, "ascii");
	archive.writeInt32LE(1, 4);
	archive.writeInt32LE(sectionSize, 8);
	archive.writeInt32LE(sectionOffset, 12);
	let position = sectionOffset;
	for (const entry of entries) {
		const name = encodeCp932(entry.name);
		const size = 1 + 4 + name.length + 1;
		archive.writeUInt8(size, position);
		archive.writeUInt32BE(entry.offset, position + 1);
		name.copy(archive, position + 5);
		position += size;
	}
	return archive;
}

describe("SH System HXP resource archives", () => {
	it("reads version four with a plain and a compressed payload", async () => {
		const plain = Buffer.from("plain body");
		const archive = buildHim4([
			payload(plain, false),
			payload(PACKED_STREAM, true),
		]);
		await expectArchive({
			format: him4Format,
			archive,
			sourcePath: "sample.hxp",
			entries: [
				{ path: "00000", size: plain.length, content: plain },
				{
					path: "00001",
					size: PACKED_EXPANDED.length,
					content: PACKED_EXPANDED,
				},
			],
		});
	});

	it("reads version five through its section descriptors", async () => {
		const plain = Buffer.from("section body");
		const entries: { name: string; offset: number }[] = [
			{ name: "one.dat", offset: 0 },
			{ name: "two.dat", offset: 0 },
		];
		// Lay the section out first so its size is known, then place the payloads behind it.
		const sectionSize = entries.reduce(
			(sum, entry) => sum + 1 + 4 + encodeCp932(entry.name).length + 1,
			0,
		);
		const firstPayload = 8 + 8 + sectionSize;
		(entries[0] as { offset: number }).offset = firstPayload;
		(entries[1] as { offset: number }).offset =
			firstPayload + payload(plain, false).length;
		const archive = Buffer.concat([
			buildHim5(entries, sectionSize),
			payload(plain, false),
			payload(PACKED_STREAM, true),
		]);
		await expectArchive({
			format: him5Format,
			archive,
			sourcePath: "sample.hxp",
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

	it("rejects a foreign signature", async () => {
		const archive = buildHim4([payload(Buffer.from("body"), false)]);
		archive.write("Him3", 0, "ascii");
		await expectArchive({
			format: him4Format,
			archive,
			sourcePath: "sample.hxp",
			detected: false,
			entries: [],
		});
	});

	it("rejects a payload whose data leaves the file", async () => {
		const archive = buildHim4([payload(Buffer.from("body"), false)]);
		// The unpacked size sits behind the stored size of the first payload, which starts behind the index.
		archive.writeUInt32LE(0x1000, 0xc + 4 + 4);
		await expectArchive({
			format: him4Format,
			archive,
			sourcePath: "sample.hxp",
			detected: false,
			entries: [],
		});
	});

	it("rejects a version five archive with a foreign signature", async () => {
		const archive = buildHim5([{ name: "one.dat", offset: 0x20 }], 12);
		archive.write("Him4", 0, "ascii");
		await expectArchive({
			format: him5Format,
			archive,
			sourcePath: "sample.hxp",
			detected: false,
			entries: [],
		});
	});
});
