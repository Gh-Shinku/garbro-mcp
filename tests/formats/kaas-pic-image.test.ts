import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { kaasPicImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	KAAS_SCRAMBLE_TABLE,
	readKaasPicLayout,
} from "../../packages/formats/src/kaas/pic-image.js";

/** The head of a picture of the engine: the mode, the key, the places of the picture and the walks. */
function head(input: {
	mode: number;
	key?: number;
	width: number;
	height: number;
	compSize1: number;
	compSize2: number;
}): Buffer {
	const bytes: Buffer = Buffer.alloc(0x12, 0x00);
	bytes[0] = input.mode;
	bytes[1] = input.key ?? 0;
	bytes.writeUInt16LE(input.width, 2);
	bytes.writeUInt16LE(input.height, 4);
	bytes.writeUInt32LE(input.compSize1, 8);
	bytes.writeUInt32LE(input.compSize2, 12);
	return bytes;
}

/** The places of a picture of a walk of its own: the three walks of the places of the file of it. */
function walkFile(input: {
	mode: number;
	key?: number;
	width: number;
	height: number;
	control: Buffer;
	data: Buffer;
	counts: Buffer;
}): Buffer {
	return Buffer.concat([
		head({
			mode: input.mode,
			key: input.key ?? 0,
			width: input.width,
			height: input.height,
			compSize1: input.control.length,
			compSize2: input.data.length,
		}),
		input.control,
		input.data,
		input.counts,
	]);
}

/** The places of the file of a picture of no walk: the places of the picture, of the counts behind them. */
function storedFile(input: {
	key: number;
	width: number;
	height: number;
	plain: Buffer;
}): Buffer {
	// The places of the file stand of the places of the picture and of the counts of the scramble behind
	// them: the walk of the picture stands of the counts of the places of the file of it.
	const base = input.key & 0x3f;
	const stored = Buffer.from(input.plain);
	for (let at = 0; at < stored.length; at += 1) {
		stored[at] =
			((stored[at] ?? 0) + (KAAS_SCRAMBLE_TABLE[base + (at & 0xff)] ?? 0)) &
			0xff;
	}
	return Buffer.concat([
		head({
			mode: 6,
			key: input.key,
			width: input.width,
			height: input.height,
			compSize1: 0,
			compSize2: 0,
		}),
		stored,
	]);
}

async function bytesOf(data: Buffer): Promise<Buffer> {
	const handle = await kaasPicImageFormat.open(
		new BufferByteSource(data),
		"image",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

/** The places of the colours of a picture of one row, of the places of the file of the bitmap of it. */
function row(bytes: Buffer, places: number): number[] {
	const out: number[] = [];
	for (let at = 0; at < places * 3; at += 1) out.push(bytes[0x36 + at] ?? 0);
	return out;
}

describe("KAAS engine image", () => {
	it("reads the head of a picture of the engine", () => {
		const layout = readKaasPicLayout(
			storedFile({ key: 5, width: 2, height: 1, plain: Buffer.alloc(6, 0x41) }),
		);
		expect(layout).toMatchObject({
			mode: 6,
			key: 5,
			width: 2,
			height: 1,
			compSize1: 0,
			compSize2: 0,
		});
		// A picture of a walk the engine knows none of and one of no width or height.
		const wrong = head({
			mode: 7,
			width: 2,
			height: 1,
			compSize1: 0,
			compSize2: 0,
		});
		expect(
			readKaasPicLayout(Buffer.concat([wrong, Buffer.alloc(8, 0x00)])),
		).toBeUndefined();
		const empty = head({
			mode: 5,
			width: 0,
			height: 1,
			compSize1: 0,
			compSize2: 0,
		});
		expect(
			readKaasPicLayout(Buffer.concat([empty, Buffer.alloc(8, 0x00)])),
		).toBeUndefined();
	});

	it("reads the places of a picture of the counts of the scramble of it", async () => {
		const plain = Buffer.from("ABCABC", "latin1");
		const data = storedFile({ key: 5, width: 2, height: 1, plain });
		const bytes = await bytesOf(data);
		expect(row(bytes, 2)).toEqual([...plain]);
	});

	it("reads the places of a picture of the walk of five places to a count", async () => {
		// Two places of the picture and a count of the places of the picture of three of them, of the
		// places of the file of the walk of them.
		const data = walkFile({
			mode: 5,
			width: 2,
			height: 1,
			// One place of the file of the walk of the places of the file of the controls of it: the
			// places of the count of them stand of the count of the places of the file of it.
			control: Buffer.from([0x80, 0x02]),
			data: Buffer.from([0x41, 0x42, 0x43, 0x01, 0x10, 0x00, 0x00]),
			counts: Buffer.alloc(0, 0x00),
		});
		const bytes = await bytesOf(data);
		expect(row(bytes, 2)).toEqual([0x41, 0x42, 0x43, 0x41, 0x42, 0x43]);
	});

	it("reads the places of a picture of the walk of eight places to a count", async () => {
		// Three places of the file and a count of the places of the picture of three of them behind them.
		const data = walkFile({
			mode: 8,
			width: 2,
			height: 1,
			control: Buffer.from([0x34]),
			data: Buffer.from([0x41, 0x42, 0x43, 0x00, 0x00, 0x00]),
			counts: Buffer.from([0x00]),
		});
		const bytes = await bytesOf(data);
		expect(row(bytes, 2)).toEqual([0x41, 0x42, 0x43, 0x41, 0x42, 0x43]);
	});

	it("reads the places of a picture of the walk of nine places to a count", async () => {
		// A count of the places of the file of the picture of six places of it, of the places of the file
		// of the walk of them.
		const data = walkFile({
			mode: 9,
			width: 2,
			height: 1,
			control: Buffer.from([0x34]),
			data: Buffer.from([0x41, 0x42, 0x43, 0x41, 0x42, 0x43, 0x00, 0x00]),
			counts: Buffer.from([0x00]),
		});
		const bytes = await bytesOf(data);
		expect(row(bytes, 2)).toEqual([0x41, 0x42, 0x43, 0x41, 0x42, 0x43]);
	});

	it("stands of the places of the file of a walk behind the places of the picture", async () => {
		// A picture whose walk stands of the places of the file of the count of the places of it alone.
		const data = walkFile({
			mode: 5,
			width: 2,
			height: 1,
			control: Buffer.from([0x00]),
			data: Buffer.from([0x00]),
			counts: Buffer.alloc(0, 0x00),
		});
		await expect(bytesOf(data)).rejects.toThrow(GarbroError);
	});

	it("tells a picture of the engine by the head of it", async () => {
		const data = storedFile({
			key: 0,
			width: 2,
			height: 1,
			plain: Buffer.alloc(6, 0x00),
		});
		expect(await kaasPicImageFormat.detect?.(new BufferByteSource(data))).toBe(
			true,
		);
		expect(
			await kaasPicImageFormat.detect?.(
				new BufferByteSource(Buffer.alloc(0x12, 0x00)),
			),
		).toBe(false);
	});
});
