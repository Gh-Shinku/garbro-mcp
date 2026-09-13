import { BufferByteSource } from "@garbro-mcp/core";
import { mcaFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const HEADER_SIZE = 0x24;
const PALETTE_SIZE = 0x400;
const BIG_BITS_PER_PIXEL = 8;

interface Frame {
	payload: Buffer;
	/** A frame of this many bytes is dropped before the offsets are read. */
	drop?: boolean;
}

/** Lays out the header, an optional palette, the offset table and the frames. */
function buildMca(frames: readonly Frame[], bitsPerPixel = 24): Buffer {
	const tableSize = frames.length * 4;
	// An eight bit archive stores the same offset, but its palette sits in front of the table.
	const tableOffset =
		HEADER_SIZE + (bitsPerPixel === BIG_BITS_PER_PIXEL ? PALETTE_SIZE : 0);
	const header = Buffer.alloc(HEADER_SIZE);
	header.write("MCA ", 0, "latin1");
	header.writeUInt32LE(HEADER_SIZE, 0x10);
	header.writeInt32LE(bitsPerPixel, 0x14);
	header.writeInt32LE(frames.length, 0x20);
	const palette = Buffer.alloc(tableOffset - HEADER_SIZE);
	const table = Buffer.alloc(tableSize);
	const payloads: Buffer[] = [];
	let cursor = tableOffset + tableSize;
	for (const [index, frame] of frames.entries()) {
		table.writeUInt32LE(cursor, index * 4);
		payloads.push(frame.payload);
		cursor += frame.payload.length;
	}
	return Buffer.concat([header, palette, table, ...payloads]);
}

function payload(size: number, fill: number): Buffer {
	return Buffer.alloc(size, fill);
}

async function expectDeclined(
	file: Buffer,
	sourcePath = "sample.mca",
): Promise<void> {
	expect(await mcaFormat.detect(new BufferByteSource(file), sourcePath)).toBe(
		false,
	);
}

describe("F&C MCA multi-frame image archive", () => {
	it("lists frames with offsets from the table", async () => {
		const first = payload(0x40, 0x11);
		const second = payload(0x50, 0x22);
		await expectArchive({
			format: mcaFormat,
			sourcePath: "sample.mca",
			archive: buildMca([{ payload: first }, { payload: second }]),
			entries: [
				{ path: "sample#0000", size: first.length, content: first },
				{ path: "sample#0001", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("names frames after the file name without its extension", async () => {
		const frame = payload(0x40, 0x33);
		await expectArchive({
			format: mcaFormat,
			sourcePath: "inside/archive.DAT",
			archive: buildMca([{ payload: frame }]),
			entries: [{ path: "archive#0000", size: frame.length, content: frame }],
		});
	});

	it("skips the palette of an eight bit archive", async () => {
		const frame = payload(0x40, 0x44);
		await expectArchive({
			format: mcaFormat,
			sourcePath: "sample.mca",
			archive: buildMca([{ payload: frame }], BIG_BITS_PER_PIXEL),
			entries: [{ path: "sample#0000", size: frame.length, content: frame }],
		});
	});

	it("drops a frame that is not longer than thirty two bytes", async () => {
		const kept = payload(0x40, 0x55);
		await expectArchive({
			format: mcaFormat,
			sourcePath: "sample.mca",
			archive: buildMca([
				{ payload: payload(0x20, 0x66), drop: true },
				{ payload: kept },
			]),
			entries: [{ path: "sample#0001", size: kept.length, content: kept }],
		});
	});

	it("rejects a foreign signature", async () => {
		const file = buildMca([{ payload: payload(0x40, 0x77) }]);
		file.write("ZZZZ", 0, "latin1");
		await expectDeclined(file);
	});

	it("rejects an archive without a usable count", async () => {
		const file = buildMca([{ payload: payload(0x40, 0x88) }]);
		file.writeInt32LE(0, 0x20);
		await expectDeclined(file);
	});

	it("rejects an index that starts behind the file", async () => {
		const file = buildMca([{ payload: payload(0x40, 0x99) }]);
		file.writeUInt32LE(file.length + 0x10, 0x10);
		await expectDeclined(file);
	});

	it("rejects an offset table that leaves the file", async () => {
		const file = buildMca([{ payload: payload(0x40, 0xaa) }]);
		file.writeUInt32LE(file.length - 2, 0x10);
		await expectDeclined(file);
	});

	it("rejects a frame that starts inside its own table", async () => {
		const file = buildMca([{ payload: payload(0x40, 0xbb) }]);
		file.writeUInt32LE(HEADER_SIZE, HEADER_SIZE);
		await expectDeclined(file);
	});

	it("rejects an archive whose frames are all dropped", async () => {
		await expectDeclined(buildMca([{ payload: payload(0x20, 0xcc) }]));
	});
});
