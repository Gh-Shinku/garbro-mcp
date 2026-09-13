import { kaguyaAn21Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const WIDTH = 8;
const HEIGHT = 1;
const CHANNELS = 1;
const IMAGE_SIZE = WIDTH * HEIGHT * CHANNELS;
const RLE_STEP = 2;
const MARKER = "[PIC]10";
const FRAME_COUNT_GAP = 0x12;
const FRAME_HEADER_SIZE = 0x14;

interface Table {
	type: number;
	payload: number;
}

interface Options {
	tables?: readonly Table[];
	marker?: string;
	rleStep?: number;
}

/**
 * Builds the preamble (tables, a counted name table and the marker), the frame count with its gap, the
 * information block, a raw first frame and one packed frame.
 */
function buildAn21(raw: Buffer, stream: Buffer, options: Options = {}): Buffer {
	const tables = options.tables ?? [
		{ type: 1, payload: 8 },
		{ type: 3, payload: 4 },
	];
	const parts: Buffer[] = [];
	parts.push(Buffer.from("AN21", "ascii"));
	const count = Buffer.alloc(2);
	count.writeUInt16LE(tables.length, 0);
	// The table records start at 8, so two bytes sit between the count and the first record.
	parts.push(count, Buffer.alloc(2));
	for (const table of tables) {
		parts.push(Buffer.from([table.type]), Buffer.alloc(table.payload));
	}
	const names = Buffer.alloc(2);
	parts.push(names);
	parts.push(Buffer.from(options.marker ?? MARKER, "latin1"));
	const frameCount = Buffer.alloc(2);
	frameCount.writeInt16LE(2, 0);
	// The reference steps 0x12 past the frame count's own position, so its two bytes are part of that gap.
	parts.push(frameCount, Buffer.alloc(FRAME_COUNT_GAP - 2));
	const info = Buffer.alloc(FRAME_HEADER_SIZE);
	info.writeUInt32LE(WIDTH, 8);
	info.writeUInt32LE(HEIGHT, 0x0c);
	info.writeInt32LE(CHANNELS, 0x10);
	parts.push(info, raw);
	const header = Buffer.alloc(5);
	header.writeUInt8(options.rleStep ?? RLE_STEP, 0);
	header.writeUInt32LE(stream.length, 1);
	parts.push(header, stream);
	return Buffer.concat(parts);
}

const STREAM = Buffer.from([0x11, 0x11, 0x02, 0x22, 0x33, 0x44, 0x55]);
const EXPECTED = Buffer.from([0x11, 0x22, 0x11, 0x33, 0x11, 0x44, 0x11, 0x55]);

describe("KaGuYa AN21 animation resource", () => {
	it("walks the preamble tables and reads a raw and a packed frame", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		await expectArchive({
			format: kaguyaAn21Format,
			archive: buildAn21(raw, STREAM),
			sourcePath: "anim.anm",
			entries: [
				{ path: "anim#00", size: IMAGE_SIZE, content: raw },
				{ path: "anim#01", size: IMAGE_SIZE, content: EXPECTED },
			],
		});
	});

	it("rejects an unknown table type", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		const archive = buildAn21(raw, STREAM, {
			tables: [{ type: 6, payload: 4 }],
		});
		await expectArchive({
			format: kaguyaAn21Format,
			archive,
			sourcePath: "anim.anm",
			detected: false,
			entries: [],
		});
	});

	it("rejects a missing marker", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		const archive = buildAn21(raw, STREAM, { marker: "[PIC]11" });
		await expectArchive({
			format: kaguyaAn21Format,
			archive,
			sourcePath: "anim.anm",
			detected: false,
			entries: [],
		});
	});

	it("rejects a zero run step", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		const archive = buildAn21(raw, STREAM, { rleStep: 0 });
		await expectArchive({
			format: kaguyaAn21Format,
			archive,
			sourcePath: "anim.anm",
			detected: false,
			entries: [],
		});
	});

	it("rejects a foreign signature", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		const archive = buildAn21(raw, STREAM);
		archive.write("AN20", 0, "ascii");
		await expectArchive({
			format: kaguyaAn21Format,
			archive,
			sourcePath: "anim.anm",
			detected: false,
			entries: [],
		});
	});
});
