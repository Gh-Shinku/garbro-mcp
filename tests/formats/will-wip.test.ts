import { BufferByteSource } from "@garbro-mcp/core";
import { willWipFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const HEADER_SIZE = 0x20;
const INDEX_OFFSET = 8;
const RECORD_SIZE = 0x18;

interface Frame {
	stored: Buffer;
	/** Extra bytes the reference reads past the declared frame size for 8-bit images. */
	palette?: Buffer;
}

/** Builds a WIPF archive: a 0x20-byte header, 0x18-byte records, then the frames. */
function buildWip(bpp: number, frames: readonly Frame[]): Buffer {
	const indexEnd = INDEX_OFFSET + frames.length * RECORD_SIZE;
	const total = frames.reduce(
		(sum, frame) => sum + frame.stored.length + (frame.palette?.length ?? 0),
		0,
	);
	const archive = Buffer.alloc(indexEnd + total, 0xaa);
	archive.write("WIPF", 0, "ascii");
	archive.writeInt16LE(frames.length, 4);
	archive.writeInt16LE(bpp, 6);
	let offset = indexEnd;
	for (const [id, frame] of frames.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		archive.writeUInt32LE(frame.stored.length, record + 0x14);
		frame.stored.copy(archive, offset);
		offset += frame.stored.length;
		if (frame.palette) {
			frame.palette.copy(archive, offset);
			offset += frame.palette.length;
		}
	}
	return archive;
}

/** The extracted form of a frame: the patched header plus its record and the stored bytes. */
function expectedFrame(archive: Buffer, id: number, stored: Buffer): Buffer {
	const header = Buffer.from(archive.subarray(0, HEADER_SIZE));
	header.writeInt16LE(1, 4);
	archive
		.subarray(
			INDEX_OFFSET + id * RECORD_SIZE,
			INDEX_OFFSET + (id + 1) * RECORD_SIZE,
		)
		.copy(header, INDEX_OFFSET);
	return Buffer.concat([header, stored]);
}

describe("Will WIP multi-frame image", () => {
	it("lists frames and prefixes each one with its synthesized header", async () => {
		const first = Buffer.from("first frame bytes");
		const second = Buffer.from("second frame bytes");
		const archive = buildWip(24, [{ stored: first }, { stored: second }]);
		await expectArchive({
			format: willWipFormat,
			archive,
			sourcePath: "sample.wip",
			metadata: { entryCount: 2 },
			entries: [
				{
					path: "sample#0000.wip",
					size: HEADER_SIZE + first.length,
					content: expectedFrame(archive, 0, first),
				},
				{
					path: "sample#0001.wip",
					size: HEADER_SIZE + second.length,
					content: expectedFrame(archive, 1, second),
				},
			],
		});
	});

	it("pads 8-bit frames with a palette block", async () => {
		const stored = Buffer.from("eight bit frame");
		const palette = Buffer.alloc(0x400, 0x11);
		const archive = buildWip(8, [{ stored, palette }]);
		await expectArchive({
			format: willWipFormat,
			archive,
			sourcePath: "sample.wip",
			entries: [
				{
					path: "sample#0000.wip",
					size: HEADER_SIZE + stored.length + palette.length,
					content: expectedFrame(archive, 0, Buffer.concat([stored, palette])),
				},
			],
		});
	});

	it("rejects a foreign signature", async () => {
		const archive = buildWip(24, [{ stored: Buffer.from("frame") }]);
		archive.write("XXXX", 0, "ascii");
		const source = new BufferByteSource(archive);
		expect(await willWipFormat.detect(source, "sample.wip")).toBe(false);
	});

	it("rejects a frame that falls outside the archive", async () => {
		const archive = buildWip(24, [{ stored: Buffer.from("frame") }]);
		archive.writeUInt32LE(0x1000, INDEX_OFFSET + 0x14);
		const source = new BufferByteSource(archive);
		expect(await willWipFormat.detect(source, "sample.wip")).toBe(false);
	});

	it("rejects an index that does not fit the archive", async () => {
		const archive = buildWip(24, [{ stored: Buffer.from("frame") }]);
		archive.writeInt16LE(0x100, 4);
		const source = new BufferByteSource(archive);
		expect(await willWipFormat.detect(source, "sample.wip")).toBe(false);
	});
});
