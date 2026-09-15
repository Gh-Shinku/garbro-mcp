import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	shiinaRioChdImageFormat,
	unpackChdRows,
} from "../../packages/formats/src/shiina-rio/chd-image.js";

/** A count to pass over, which a byte of `0xFF` sends on to a word. */
function passWord(count: number): Buffer {
	if (count >= 0xff) {
		const word: Buffer = Buffer.alloc(3);
		word[0] = 0xff;
		word.writeUInt16LE(count, 1);
		return word;
	}
	return Buffer.from([count]);
}

/** A count of bytes to read, which a count of nothing sends on to a word. */
function runWord(count: number): Buffer {
	if (0 === count || count > 0xff) {
		const word: Buffer = Buffer.alloc(3);
		word.writeUInt16LE(count, 1);
		return word;
	}
	return Buffer.from([count]);
}

/** A row that reads the given bytes from its first pixel, with no count to pass over. */
function wholeRow(bytes: Buffer): Buffer {
	return Buffer.concat([passWord(0), runWord(bytes.length), bytes]);
}

interface ChdParts {
	width: number;
	height: number;
	offsetX?: number;
	offsetY?: number;
	rows: Buffer[];
	/** The words of the index, the first that is not nothing naming the measurements. */
	index?: number[];
	count?: number;
	/** Writes the rows into the file in the order they stand in the index turned around. */
	reverseRows?: boolean;
}

function chdFile(parts: ChdParts): Buffer {
	const count = parts.count ?? Math.max(1, parts.index?.length ?? 0);
	const head: Buffer = Buffer.alloc(12 + count * 4, 0x00);
	head.write("CHD\0", 0, "latin1");
	head.writeInt32LE(count, 4);
	for (let index = 0; index < count; index += 1) {
		head.writeUInt32LE(parts.index?.[index] ?? 0, 12 + index * 4);
	}
	// With no index of its own the first word names the measurements, which stand right behind the index.
	if (parts.index === undefined && count > 0) {
		head.writeUInt32LE(head.length, 12);
	}
	const placement: Buffer = Buffer.alloc(16, 0x00);
	placement.writeUInt32LE(parts.width, 0);
	placement.writeUInt32LE(parts.height, 4);
	placement.writeInt32LE(parts.offsetX ?? 0, 8);
	placement.writeInt32LE(parts.offsetY ?? 0, 12);
	const table: Buffer = Buffer.alloc(parts.rows.length * 4, 0x00);
	const chunks: Buffer[] = [head, placement, table];
	let position = head.length + placement.length + table.length;
	const order = parts.rows.map((_, index) => index);
	if (parts.reverseRows) order.reverse();
	for (const index of order) {
		const row = parts.rows[index] ?? Buffer.alloc(0);
		table.writeUInt32LE(position, index * 4);
		chunks.push(row);
		position += row.length;
	}
	return Buffer.concat(chunks);
}

function layoutOf(parts: ChdParts): Parameters<typeof unpackChdRows>[1] {
	const layout = {
		width: parts.width,
		height: parts.height,
		offsetX: parts.offsetX ?? 0,
		offsetY: parts.offsetY ?? 0,
		firstOffset: 0,
		rowsOffset: 0,
	};
	return layout;
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await shiinaRioChdImageFormat.open(
		new BufferByteSource(data),
		"forest.chd",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** Where the pixels of a grey bitmap begin. */
const PIXELS = 0x36 + 0x400;

describe("Forest image format", () => {
	it("finds a picture by its signature", async () => {
		const data = chdFile({
			width: 2,
			height: 1,
			rows: [wholeRow(Buffer.from([0x00, 0x01]))],
		});
		expect(
			await shiinaRioChdImageFormat.detect(
				new BufferByteSource(data),
				"forest.chd",
			),
		).toBe(true);
	});

	it("declines an index the reference does not read", async () => {
		const parts = {
			width: 2,
			height: 1,
			rows: [wholeRow(Buffer.from([0x00, 0x01]))],
		};
		for (const broken of [
			{ ...parts, count: 0 },
			{ ...parts, count: -1 },
			{ ...parts, count: 0x100000 },
			{ ...parts, index: [0, 0] },
			{ ...parts, index: [0x1000] },
		]) {
			const data = chdFile(broken);
			expect(
				await shiinaRioChdImageFormat.detect(
					new BufferByteSource(data),
					"forest.chd",
				),
			).toBe(false);
		}
	});

	it("takes the first word of the index that is not nothing", async () => {
		// The words behind it are never looked at, so one that names nothing is no reason to decline the file.
		const data = chdFile({
			width: 2,
			height: 1,
			index: [0x14, 0x4000],
			rows: [wholeRow(Buffer.from([0x00, 0x01]))],
		});
		expect(
			await shiinaRioChdImageFormat.detect(
				new BufferByteSource(data),
				"forest.chd",
			),
		).toBe(true);
	});

	it("reports the measurements and the place of the picture", async () => {
		const data = chdFile({
			width: 2,
			height: 1,
			offsetX: 5,
			offsetY: -6,
			rows: [wholeRow(Buffer.from([0x00, 0x01]))],
		});
		const handle = await shiinaRioChdImageFormat.open(
			new BufferByteSource(data),
			"dir/forest.chd",
		);
		expect(handle.entries[0]?.path).toBe("forest.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 32,
			offsetX: 5,
			offsetY: -6,
		});
	});

	it("unfolds a row of pixels, each carrying its bias", async () => {
		const out = await extract(
			chdFile({
				width: 4,
				height: 1,
				rows: [wholeRow(Buffer.from([0x01, 0x02, 0x03, 0x04]))],
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		expect(out.readUInt32LE(0x0a)).toBe(PIXELS);
		expect(out.subarray(PIXELS, PIXELS + 4).toString("hex")).toBe("58595a5b");
	});

	it("places every row where its offset says it stands", async () => {
		// The rows stand in the file the other way round from the order they are read in, so the offsets of
		// the rows decide where each of them lands.
		const out = await extract(
			chdFile({
				width: 2,
				height: 2,
				reverseRows: true,
				rows: [
					wholeRow(Buffer.from([0x10, 0x11])),
					wholeRow(Buffer.from([0x20, 0x21])),
				],
			}),
		);
		// Every row of a bitmap is written on its own, so the two pixels of the first row are padded to four
		// before the second row stands.
		expect(out.subarray(PIXELS, PIXELS + 2).toString("hex")).toBe("6768");
		expect(out.subarray(PIXELS + 4, PIXELS + 6).toString("hex")).toBe("7778");
	});

	it("reads a count to pass over that a byte cannot hold", async () => {
		// A count of two hundred and fifty five is written as the byte `0xFF` and a word behind it; the reader
		// then takes forty five bytes, which land at the start of the row because the reference moves its place
		// in the row without moving the place it writes to.
		const bytes: Buffer = Buffer.alloc(45, 0x00);
		for (let index = 0; index < bytes.length; index += 1) {
			bytes[index] = index;
		}
		const out = await extract(
			chdFile({
				width: 300,
				height: 1,
				rows: [Buffer.concat([passWord(255), runWord(45), bytes])],
			}),
		);
		const line = out.subarray(PIXELS, PIXELS + 300);
		expect(line.subarray(0, 3).toString("hex")).toBe("575859");
		expect(line[44]).toBe((44 + 0x57) & 0xff);
		expect(line[255]).toBe(0x00);
	});

	it("ends a row where a count to pass over is all that is left", async () => {
		const out = await extract(
			chdFile({ width: 4, height: 1, rows: [passWord(4)] }),
		);
		expect(out.subarray(PIXELS, PIXELS + 4).toString("hex")).toBe("00000000");
	});

	it("carries the bias onto the pixels a short run does not reach", async () => {
		const out = await extract(
			chdFile({
				width: 4,
				height: 1,
				rows: [
					Buffer.concat([passWord(0), runWord(4), Buffer.from([0x01, 0x02])]),
				],
			}),
		);
		expect(out.subarray(PIXELS, PIXELS + 4).toString("hex")).toBe("58595757");
	});

	it("writes a run that reaches past its row into the row behind it", async () => {
		// The row behind ends where it begins, so the byte the first row spills stands as the first pixel of
		// it, where the bitmap writer places it because every row of a bitmap is written on its own.
		const out = await extract(
			chdFile({
				width: 2,
				height: 2,
				rows: [
					Buffer.concat([
						passWord(0),
						runWord(3),
						Buffer.from([0x01, 0x02, 0x03]),
					]),
					passWord(2),
				],
			}),
		);
		expect(out.subarray(PIXELS, PIXELS + 4).toString("hex")).toBe("58590000");
		expect(out.subarray(PIXELS + 4, PIXELS + 8).toString("hex")).toBe(
			"5a000000",
		);
	});

	it("refuses a run that reaches past the picture", async () => {
		const data = chdFile({
			width: 2,
			height: 1,
			rows: [
				Buffer.concat([
					passWord(0),
					runWord(3),
					Buffer.from([0x01, 0x02, 0x03]),
				]),
			],
		});
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow(
			"Forest picture holds a run past its end",
		);
	});

	it("refuses a row whose offset names nothing", async () => {
		const data = chdFile({
			width: 2,
			height: 2,
			rows: [wholeRow(Buffer.from([0x01, 0x02])), Buffer.alloc(0)],
		});
		// Point the second row at the end of the file.
		data.writeUInt32LE(data.length, 12 + 4 + 16 + 4);
		await expect(extract(data)).rejects.toThrow(
			"Forest picture is cut short of its pixels",
		);
	});

	it("stops at a run of no bytes", () => {
		const layout = layoutOf({ width: 2, height: 1, rows: [] });
		layout.rowsOffset = 16;
		layout.height = 1;
		const data: Buffer = Buffer.alloc(16 + 4, 0x00);
		data.writeUInt32LE(0x14, 16);
		data.writeUInt32LE(0x14, 0);
		data.writeUInt32LE(1, 4);
		expect(() => unpackChdRows(data, layout)).toThrow(
			"Forest picture is cut short of its pixels",
		);
	});
});
