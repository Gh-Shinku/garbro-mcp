import { kaguyaPl10Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const FIRST_FRAME_OFFSET = 0x16;
const FRAME_HEADER_SIZE = 0x14;
const WIDTH = 8;
const HEIGHT = 1;
const DEPTH = 1;
const IMAGE_SIZE = WIDTH * HEIGHT * DEPTH;
const RLE_STEP = 2;

interface PackedFrame {
	rleStep: number;
	stream: Buffer;
	expected: Buffer;
}

/** Builds the head, a raw first frame, and packed frames behind a step byte and a packed size. */
function buildPl10(raw: Buffer, packed: readonly PackedFrame[]): Buffer {
	const parts: Buffer[] = [];
	const head = Buffer.alloc(FIRST_FRAME_OFFSET + FRAME_HEADER_SIZE);
	head.write("PL10", 0, "ascii");
	head.writeInt16LE(1 + packed.length, 4);
	head.writeUInt32LE(WIDTH, FIRST_FRAME_OFFSET + 8);
	head.writeUInt32LE(HEIGHT, FIRST_FRAME_OFFSET + 0x0c);
	head.writeUInt32LE(DEPTH, FIRST_FRAME_OFFSET + 0x10);
	parts.push(head, raw);
	for (const frame of packed) {
		const header = Buffer.alloc(5);
		header.writeUInt8(frame.rleStep, 0);
		header.writeUInt32LE(frame.stream.length, 1);
		parts.push(header, frame.stream);
	}
	return Buffer.concat(parts);
}

/** A simple run fills the rest of its lane; an extended run always claims at least 128 bytes. */
const SIMPLE_RUN: PackedFrame = {
	rleStep: RLE_STEP,
	stream: Buffer.from([0x11, 0x11, 0x02, 0x22, 0x33, 0x44, 0x55]),
	expected: Buffer.from([0x11, 0x22, 0x11, 0x33, 0x11, 0x44, 0x11, 0x55]),
};

const EXTENDED_RUN: PackedFrame = {
	rleStep: RLE_STEP,
	stream: Buffer.from([0xaa, 0xaa, 0x80, 0x00, 0x11, 0x22, 0x33, 0x44]),
	expected: Buffer.from([0xaa, 0x11, 0xaa, 0x22, 0xaa, 0x33, 0xaa, 0x44]),
};

describe("KaGuYa PL10 animation resource", () => {
	it("reads a raw first frame and an RLE packed frame", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		await expectArchive({
			format: kaguyaPl10Format,
			archive: buildPl10(raw, [SIMPLE_RUN]),
			sourcePath: "anim.plt",
			entries: [
				{ path: "anim#00", size: IMAGE_SIZE, content: raw },
				{
					path: "anim#01",
					size: IMAGE_SIZE,
					content: SIMPLE_RUN.expected,
				},
			],
		});
	});

	it("decodes an extended run length", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		await expectArchive({
			format: kaguyaPl10Format,
			archive: buildPl10(raw, [SIMPLE_RUN, EXTENDED_RUN]),
			sourcePath: "anim.plt",
			entries: [
				{ path: "anim#00", size: IMAGE_SIZE, content: raw },
				{ path: "anim#01", size: IMAGE_SIZE, content: SIMPLE_RUN.expected },
				{ path: "anim#02", size: IMAGE_SIZE, content: EXTENDED_RUN.expected },
			],
		});
	});

	it("rejects a zero run step", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		const archive = buildPl10(raw, [{ ...SIMPLE_RUN, rleStep: 0 }]);
		await expectArchive({
			format: kaguyaPl10Format,
			archive,
			sourcePath: "anim.plt",
			detected: false,
			entries: [],
		});
	});

	it("rejects the sibling PL00 signature", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		const archive = buildPl10(raw, []);
		archive.write("PL00", 0, "ascii");
		await expectArchive({
			format: kaguyaPl10Format,
			archive,
			sourcePath: "anim.plt",
			detected: false,
			entries: [],
		});
	});

	it("rejects a packed frame that runs past the file", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		const archive = buildPl10(raw, [SIMPLE_RUN]);
		// The packed size word sits behind the step byte of the first packed frame.
		const packedSizeOffset =
			FIRST_FRAME_OFFSET + FRAME_HEADER_SIZE + IMAGE_SIZE + 1;
		archive.writeUInt32LE(0x100, packedSizeOffset);
		await expectArchive({
			format: kaguyaPl10Format,
			archive,
			sourcePath: "anim.plt",
			detected: false,
			entries: [],
		});
	});
});
