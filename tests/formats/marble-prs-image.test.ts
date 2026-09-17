import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	hasDummyAlpha,
	marblePrsImageFormat,
	readPrsLayout,
	unpackPrs,
} from "../../packages/formats/src/marble/prs-image.js";

const HEADER_SIZE = 0x10;

interface PrsOptions {
	flag?: number;
	depth?: number;
	width?: number;
	height?: number;
	packedSize?: number;
}

function prsFile(stream: Buffer, options: PrsOptions = {}): Buffer {
	const head = Buffer.alloc(HEADER_SIZE);
	head[0] = 0x59;
	head[1] = 0x42;
	head[2] = options.flag ?? 0;
	head[3] = options.depth ?? 3;
	head.writeUInt32LE(options.packedSize ?? stream.length, 4);
	head.writeUInt16LE(options.width ?? 2, 12);
	head.writeUInt16LE(options.height ?? 1, 14);
	return Buffer.concat([head, stream]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await marblePrsImageFormat.open(
		new BufferByteSource(data),
		"pic.prs",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** A control byte whose first `literals` bits are clear and the next one set, taken from the highest down. */
function control(literals: number, copy: boolean): number {
	if (!copy) return 0;
	return 0x80 >> literals;
}

describe("Marble engine image", () => {
	it("reads the head as the reference does", () => {
		const layout = readPrsLayout(
			prsFile(Buffer.alloc(0), { depth: 4, width: 3, height: 2 }),
		);
		expect(layout).toEqual({
			width: 3,
			height: 2,
			depth: 4,
			flag: 0,
			packedSize: 0,
		});
	});

	it("gates on the two letters and the depth", async () => {
		const data = prsFile(Buffer.alloc(0));
		expect(
			await marblePrsImageFormat.detect(new BufferByteSource(data), "pic.prs"),
		).toBe(true);
		// The depth is three or four bytes a pixel.
		const odd = prsFile(Buffer.alloc(0), { depth: 2 });
		expect(readPrsLayout(odd)).toBeUndefined();
		// And the two letters have to stand.
		const other = Buffer.from(data);
		other[0] = 0x58;
		expect(readPrsLayout(other)).toBeUndefined();
	});

	it("reports the measurements of the picture", async () => {
		const handle = await marblePrsImageFormat.open(
			new BufferByteSource(
				prsFile(Buffer.alloc(0), { width: 4, height: 2, depth: 4 }),
			),
			"dir/pic.prs",
		);
		expect(handle.entries[0]?.path).toBe("pic.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 4,
			height: 2,
			bitsPerPixel: 32,
		});
	});

	it("unfolds a stream of literals", async () => {
		const stream = Buffer.from([control(0, false), 1, 2, 3, 0x11, 0x12, 0x13]);
		const out = await extract(prsFile(stream));
		expect(out.readUInt16LE(0x1c)).toBe(24);
		expect(out.subarray(54, 62).toString("hex")).toBe("0102031112130000");
	});

	it("unfolds a copy whose count and distance stand in its own word", () => {
		// Six literals, then a copy of six bytes from six behind: the distance stands in the high part of the
		// word and the count less three in its low nibble.
		const stream = Buffer.from([
			control(6, true),
			1,
			2,
			3,
			0x11,
			0x12,
			0x13,
			0x80,
			0x53,
		]);
		const data = prsFile(stream, { width: 4, height: 1 });
		const layout = readPrsLayout(data);
		if (!layout) throw new Error("no layout");
		const out = unpackPrs(data, layout);
		expect(out.toString("hex")).toBe("010203111213010203111213");
	});

	it("unfolds a run of literals of the third kind", () => {
		// A byte whose two low bits are all set holds a run of bytes that stand in the stream themselves.
		const stream = Buffer.from([
			control(0, true),
			0x03,
			1,
			2,
			3,
			4,
			5,
			6,
			7,
			8,
			9,
		]);
		const layout = readPrsLayout(prsFile(stream, { width: 3, height: 1 }));
		if (!layout) throw new Error("no layout");
		expect(
			unpackPrs(prsFile(stream, { width: 3, height: 1 }), layout).toString(
				"hex",
			),
		).toBe("010203040506070809");
	});

	it("unfolds a copy whose count stands in the table of its own", () => {
		const stream = Buffer.from([control(3, true), 1, 2, 3, 0xc0, 0x02, 0x00]);
		const layout = readPrsLayout(prsFile(stream));
		if (!layout) throw new Error("no layout");
		expect(unpackPrs(prsFile(stream), layout).toString("hex")).toBe(
			"010203010203",
		);
	});

	it("walks the bytes of a differential picture", () => {
		const stream = Buffer.from([control(0, false), 1, 2, 3, 0x10, 0x10, 0x10]);
		const layout = readPrsLayout(prsFile(stream, { flag: 0x80 }));
		if (!layout) throw new Error("no layout");
		expect(
			unpackPrs(prsFile(stream, { flag: 0x80 }), layout).toString("hex"),
		).toBe("010203111213");
		// Without the flag the same stream stands as it is.
		const plain = readPrsLayout(prsFile(stream));
		if (!plain) throw new Error("no layout");
		expect(unpackPrs(prsFile(stream), plain).toString("hex")).toBe(
			"010203101010",
		);
	});

	it("reads a picture whose alpha channel holds one value as having none", async () => {
		const dummy = Buffer.from([
			control(0, false),
			1,
			2,
			3,
			0x7f,
			0x11,
			0x12,
			0x13,
			0x7f,
		]);
		const out = await extract(prsFile(dummy, { depth: 4 }));
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(out.subarray(54, 62).toString("hex")).toBe("0102030011121300");
		// A real alpha channel is kept.
		const real = Buffer.from([
			control(0, false),
			1,
			2,
			3,
			0xff,
			0x11,
			0x12,
			0x13,
			0x40,
		]);
		const kept = await extract(prsFile(real, { depth: 4 }));
		expect(kept.subarray(54, 62).toString("hex")).toBe("010203ff11121340");
		expect(hasDummyAlpha(Buffer.from([1, 2, 3, 0x7f, 4, 5, 6, 0x7f]))).toBe(
			true,
		);
		expect(hasDummyAlpha(Buffer.from([1, 2, 3, 0xff, 4, 5, 6, 0xff]))).toBe(
			false,
		);
	});

	it("refuses a copy that reaches before the start of the picture", () => {
		const stream = Buffer.from([control(0, true), 0x00, 0x00]);
		const layout = readPrsLayout(prsFile(stream));
		if (!layout) throw new Error("no layout");
		expect(() => unpackPrs(prsFile(stream), layout)).toThrow(GarbroError);
		expect(() => unpackPrs(prsFile(stream), layout)).toThrow(
			"before its own start",
		);
	});
});
