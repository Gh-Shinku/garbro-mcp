// The AliceSoft System incremental picture port, against pictures built in the test: the head of the picture
// (the name of the picture of the count of the walk of the engine in front of it, of the counts of the walk
// of the engine of its own), the counts of the walk of the engine of the head of it (`dfdl` of a count of no
// name at all, `ptdl` of the places of the count of the picture itself, `dcgd` of the places of the picture)
// and the places of the picture of the count of the walk of the engine of its own.
import { Buffer } from "node:buffer";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { deflateSync } from "node:zlib";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { alicesoftDcfImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { withCompanionFiles } from "../helpers/companion.js";
import {
	readQntLayout,
	unpackQnt,
} from "../../packages/formats/src/alicesoft/qnt-image.js";

const HEAD_SIZE = 0x1c;
const QNT_HEAD = 0x30;

/** The places of a picture of one count of a colour: the head of it and the counts of the walk of its own. */
function qntPicture(
	width: number,
	height: number,
	places: number[],
	alpha = false,
): Buffer {
	const packed = Buffer.alloc(width * height * 3);
	for (const [at, place] of places.entries())
		packed[at % packed.length] = place;
	const part = deflateSync(packed);
	let alphaPart = Buffer.alloc(0);
	if (alpha) {
		const mask = Buffer.alloc(width * height, 0x40);
		alphaPart = deflateSync(mask);
	}
	const head = Buffer.alloc(QNT_HEAD, 0);
	head.write("QNT", 0, "latin1");
	head.writeInt32LE(0, 4);
	head.writeUInt32LE(width, 0x10);
	head.writeUInt32LE(height, 0x14);
	head.writeInt32LE(alpha ? 32 : 24, 0x18);
	head.writeUInt32LE(part.length, 0x20);
	head.writeUInt32LE(alphaPart.length, 0x24);
	return Buffer.concat([head, part, alphaPart]);
}

/** The places the counts of the walk of the engine of a picture of the engine stand for. */
function overlayPixels(qnt: Buffer): Buffer {
	const layout = readQntLayout(qnt, qnt.length);
	if (!layout) throw new Error("the head stands in the picture");
	const first = inflatePart(qnt, layout.headerSize, layout.rgbSize);
	const second =
		layout.alphaSize === 0
			? undefined
			: inflatePart(qnt, layout.headerSize + layout.rgbSize, layout.alphaSize);
	return unpackQnt(first, second, layout);
}

function inflatePart(data: Buffer, at: number, size: number): Buffer {
	const { inflateSync } = require("node:zlib") as typeof import("node:zlib");
	return inflateSync(data.subarray(at, at + size));
}

/** The counts of the walk of the engine of the head of a picture, of the name of the picture in front of it. */
function dcfHead(input: {
	signature?: string;
	width: number;
	height: number;
	bitsPerPixel?: number;
	name: string;
	headerSize: number;
}): Buffer {
	const name = Buffer.from(input.name, "latin1");
	const shift = (name.length % 7) + 1;
	const rotated = Buffer.alloc(name.length);
	for (const [at, place] of name.entries()) {
		// The reference rotates the stored bytes to the left to stand of the name of the picture, so the
		// fixture stands of the places of the name of the count of the walk of the engine to the right.
		rotated[at] = ((place >>> shift) | (place << (8 - shift))) & 0xff;
	}
	const head = Buffer.alloc(HEAD_SIZE + rotated.length, 0);
	head.write(input.signature ?? "dcf ", 0, "latin1");
	head.writeUInt32LE(input.headerSize, 4);
	head.writeInt32LE(1, 8);
	head.writeUInt32LE(input.width, 0x0c);
	head.writeUInt32LE(input.height, 0x10);
	head.writeInt32LE(input.bitsPerPixel ?? 24, 0x14);
	head.writeInt32LE(rotated.length, 0x18);
	rotated.copy(head, HEAD_SIZE);
	return head;
}

/** The counts of the walk of the engine of the places of the count of the picture of the engine. */
function chunk(id: string, body: Buffer): Buffer {
	const head = Buffer.alloc(8, 0);
	head.write(id, 0, "latin1");
	head.writeUInt32LE(body.length, 4);
	return Buffer.concat([head, body]);
}

function maskChunk(mask: Buffer): Buffer {
	// The counts of the walk of the engine of the count of no name at all stand of the counts of the walk of
	// the engine of the counts of the walk of the engine of their own.
	const part = deflateSync(mask);
	const body = Buffer.alloc(4 + part.length, 0);
	body.writeInt32LE(mask.length, 0);
	part.copy(body, 4);
	return chunk("dfdl", body);
}

function offsetChunk(x: number, y: number): Buffer {
	const body = Buffer.alloc(8, 0);
	body.writeInt32LE(x, 0);
	body.writeInt32LE(y, 4);
	return chunk("ptdl", body);
}

function buildPicture(input: {
	head: Buffer;
	chunks?: Buffer[];
	qnt: Buffer;
}): Buffer {
	// The counts of the walk of the engine of the places of the picture stand at the places of the count of
	// the walk of the engine of the two counts of the places of the head of the picture itself: the count of
	// the walk of the engine of the head of it stands of the places of the count of the walk of the engine of
	// the count of the walk of the picture of the count of the walk of the engine behind the places of the
	// count of the walk of the engine of the count of the walk of the engine of its own.
	const head = Buffer.from(input.head);
	head.writeUInt32LE(input.head.length - 8, 4);
	return Buffer.concat([
		head,
		...(input.chunks ?? []),
		chunk(
			input.head.toString("latin1", 0, 4) === "pcf " ? "pcgd" : "dcgd",
			Buffer.alloc(0),
		),
		input.qnt,
	]);
}

async function extract(data: Buffer, name = "picture.dcf"): Promise<Buffer> {
	const handle = await alicesoftDcfImageFormat.open(
		new BufferByteSource(data),
		name,
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("AliceSoft System incremental picture", () => {
	it("reads the head of the picture and the name of the picture in front of it", async () => {
		const qnt = qntPicture(16, 16, [1, 2, 3, 4]);
		const data = buildPicture({
			head: dcfHead({
				width: 16,
				height: 16,
				name: "base",
				headerSize: 0,
			}),
			qnt,
		});
		expect(
			await alicesoftDcfImageFormat.detect(
				new BufferByteSource(data),
				"picture.dcf",
			),
		).toBe(true);
		const handle = await alicesoftDcfImageFormat.open(
			new BufferByteSource(data),
			"picture.dcf",
		);
		try {
			expect(handle.metadata).toMatchObject({
				width: 16,
				height: 16,
				baseName: "base",
			});
			expect(handle.entries[0]?.path).toBe("picture.bmp");
		} finally {
			await handle.close();
		}
		// The places of the picture stand of the counts of the walk of the engine of the places of the
		// picture of the count of the walk of the engine of its own.
		const out = await extract(data);
		const image = readBmpImage(out);
		if (!image) throw new Error("no bitmap of the walk");
		expect(image).toMatchObject({ width: 16, height: 16, bitsPerPixel: 24 });
		expect([...image.pixels]).toEqual([...overlayPixels(qnt)]);
	});

	it("stands of the counts of the walk of the engine of the count of no name at all", async () => {
		// The counts of the walk of the engine of the count of no name at all stand of the places of the
		// count of the walk of the engine of the picture behind the counts of the walk of the engine of the
		// count of the walk of the engine of its own.
		const base = qntPicture(16, 16, [7, 7, 7, 7]);
		const qnt = qntPicture(16, 16, [1, 2, 3, 4]);
		const data = buildPicture({
			head: dcfHead({
				width: 16,
				height: 16,
				name: "base",
				headerSize: 0,
			}),
			chunks: [maskChunk(Buffer.from([0, 0, 0, 0, 1]))],
			qnt,
		});
		await withCompanionFiles(
			"picture.dcf",
			{ "picture.dcf": data, "base.qnt": base },
			async (path) => {
				const image = readBmpImage(await extract(data, path));
				if (!image) throw new Error("no bitmap of the walk");
				const expected: number[] = [];
				const basePixels = overlayPixels(base);
				for (let at = 0; at < 16 * 16; at += 1) {
					for (let place = 0; place < 3; place += 1) {
						expected.push(basePixels[at * 3 + place] ?? 0);
					}
				}
				// The counts of the walk of the engine of the places of the count of the walk of the engine
				// stand of the places of the picture of the count of the walk of the engine in front of them:
				// the count of the walk of the picture of the count of the walk of the engine of the places of
				// the count of the walk of the engine of its own stands of the places of the picture.
				expect([...image.pixels]).toEqual(expected);
			},
		);
	});

	it("stands of the counts of the walk of the engine of the places of the picture of the engine of its own", async () => {
		// A picture of the counts of the walk of the engine of the places of the picture of its own stands of
		// the places of the picture of the count of the walk of the engine over the places of the picture of
		// the count of the walk of the engine in front of it, of the places of the count of the walk of the
		// engine of the count of the walk of the picture itself.
		const qnt = qntPicture(8, 8, [1, 2, 3, 4], true);
		const data = buildPicture({
			head: dcfHead({
				signature: "pcf ",
				width: 16,
				height: 16,
				bitsPerPixel: 32,
				name: "base",
				headerSize: 0,
			}),
			chunks: [offsetChunk(4, 4)],
			qnt,
		});
		const image = readBmpImage(await extract(data, "picture.pcf"));
		if (!image) throw new Error("no bitmap of the walk");
		expect(image).toMatchObject({ width: 16, height: 16, bitsPerPixel: 32 });
		const overlay = overlayPixels(qnt);
		const expected: number[] = [];
		for (let y = 0; y < 16; y += 1) {
			for (let x = 0; x < 16; x += 1) {
				const inside = x >= 4 && x < 12 && y >= 4 && y < 12;
				const at = (y - 4) * 8 + (x - 4);
				// The counts of the walk of the engine of the places of the picture of the count of the walk
				// of the engine of its own stand of the places of the count of the walk of the engine behind
				// the places of the count of the walk of the engine of the count of the walk of the picture
				// in front of it: the count of the walk of the picture of no count of the walk of the engine
				// at all stands of the places of the count of the walk of the picture itself.
				// The counts of the walk of the engine of the places of the picture of the count of the walk
				// of the engine of its own stand of the places of the count of the walk of the picture behind
				// the places of the count of the walk of the engine of the count of the walk of the picture
				// in front of them where the count of the walk of the engine of the places of the count of
				// the walk of the picture of its own stands of no count of the walk of the engine at all.
				const alpha = inside ? (overlay[at * 4 + 3] ?? 0) : 0;
				const shown = 0 !== alpha;
				for (let place = 0; place < 4; place += 1) {
					expected.push(inside && shown ? (overlay[at * 4 + place] ?? 0) : 0);
				}
			}
		}
		expect([...image.pixels]).toEqual(expected);
	});

	it("turns away a picture of another kind", async () => {
		const qnt = qntPicture(16, 16, [1]);
		const other = buildPicture({
			head: dcfHead({
				signature: "pcx ",
				width: 16,
				height: 16,
				name: "base",
				headerSize: 0,
			}),
			qnt,
		});
		expect(
			await alicesoftDcfImageFormat.detect(
				new BufferByteSource(other),
				"other.dcf",
			),
		).toBe(false);
		const short = Buffer.alloc(HEAD_SIZE - 4);
		short.write("dcf ", 0, "latin1");
		expect(
			await alicesoftDcfImageFormat.detect(
				new BufferByteSource(short),
				"short.dcf",
			),
		).toBe(false);
	});
});
