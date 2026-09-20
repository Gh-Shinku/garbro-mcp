import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	activeSoftEdtImageFormat,
	readEdtLayout,
	unpackEdtPicture,
} from "../../packages/formats/src/active-soft/edt-image.js";

const MARK = ".TRUE\x8d\x5d\x8c\xcb\x00";
const HEAD_SIZE = 0x22;

const PICTURES: readonly {
	name: string;
	width: number;
	height: number;
	packed: string;
	extra: string;
	out: string;
}[] = [
	{
		name: "literal",
		width: 8,
		height: 4,
		packed: "00000000000000000000000000000000",
		extra:
			"101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f",
		out: "101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f",
	},
	{
		name: "row",
		width: 8,
		height: 4,
		packed: "80c6010000",
		extra:
			"101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f",
		out: "101112131415161718191a1b1c1d1e1f2021222324252627101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f5051525354555657",
	},
	{
		name: "delta",
		width: 8,
		height: 4,
		packed: "80110000000000",
		extra:
			"101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f",
		out: "101112131415161718191a1b1c1d1e1f202122232425262725262628292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c",
	},
];

function buildPicture(picture: (typeof PICTURES)[number]): Buffer {
	const packed = Buffer.from(picture.packed, "hex");
	const extra = Buffer.from(picture.extra, "hex");
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write(MARK, 0, "latin1");
	head.writeUInt16LE(picture.width, 0xe);
	head.writeUInt16LE(picture.height, 0x10);
	head.writeUInt32LE(packed.length, 0x1a);
	head.writeUInt32LE(extra.length, 0x1e);
	return Buffer.concat([head, packed, extra]);
}

describe("Active Soft RGB image format", () => {
	it("reads the head of a picture", () => {
		const picture = PICTURES[0];
		if (!picture) throw new Error("no picture");
		const file = buildPicture(picture);
		expect(readEdtLayout(file, file.length)).toEqual({
			width: picture.width,
			height: picture.height,
			compSize: 16,
			extraSize: picture.width * picture.height * 3,
			dataOffset: HEAD_SIZE,
		});
	});

	it("turns away a head that names no picture of this kind", () => {
		const picture = PICTURES[0];
		if (!picture) throw new Error("no picture");
		const wrongMark = buildPicture(picture);
		wrongMark.write(".TRUF", 0, "latin1");
		expect(readEdtLayout(wrongMark, wrongMark.length)).toBeUndefined();
		const noExtra = buildPicture(picture);
		noExtra.writeUInt32LE(0, 0x1e);
		expect(readEdtLayout(noExtra, noExtra.length)).toBeUndefined();
		const badExtra = buildPicture(picture);
		badExtra.writeUInt32LE(1, 0x1e);
		expect(readEdtLayout(badExtra, badExtra.length)).toBeUndefined();
		expect(readEdtLayout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("walks the places of the pictures of the test", () => {
		for (const picture of PICTURES) {
			const file = buildPicture(picture);
			const layout = readEdtLayout(file, file.length);
			if (!layout) throw new Error(`no layout for ${picture.name}`);
			expect(unpackEdtPicture(file, layout), picture.name).toEqual(
				Buffer.from(picture.out, "hex"),
			);
		}
	});

	it("stands the places of a picture out as a picture of the three places of a place of it", async () => {
		for (const picture of PICTURES) {
			const file = buildPicture(picture);
			const handle = await activeSoftEdtImageFormat.open(
				new BufferByteSource(file),
				`${picture.name}.edt`,
			);
			const entry = handle.entries[0];
			if (!entry) throw new Error("no entry");
			const bmp = await consumeBuffer(await handle.openEntry(entry.id));
			expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
			expect(bmp.readUInt16LE(0x1c)).toBe(24);
			expect(bmp.readInt32LE(0x12)).toBe(picture.width);
			expect(bmp.readInt32LE(0x16)).toBe(-picture.height);
			const stride = (picture.width * 3 + 3) & ~3;
			const places = Buffer.from(picture.out, "hex");
			for (let row = 0; row < picture.height; row += 1) {
				expect(
					bmp.subarray(
						0x36 + row * stride,
						0x36 + row * stride + picture.width * 3,
					),
					picture.name,
				).toEqual(
					places.subarray(
						row * picture.width * 3,
						(row + 1) * picture.width * 3,
					),
				);
			}
		}
	});

	it("turns a picture cut short of the places of the walk of it away", () => {
		const picture = PICTURES[1];
		if (!picture) throw new Error("no picture");
		const file = buildPicture(picture);
		const cut = file.subarray(0, file.length - 12);
		expect(readEdtLayout(cut, cut.length)).toBeUndefined();
		const short = buildPicture({
			...picture,
			extra: picture.extra.slice(0, 6),
		});
		const layout = readEdtLayout(short, short.length);
		if (!layout) throw new Error("no layout");
		expect(() => unpackEdtPicture(short, layout)).toThrow(GarbroError);
	});

	it("is told by the words of the picture", async () => {
		expect(activeSoftEdtImageFormat.descriptor.id).toBe(
			"active-soft-edt-image",
		);
		const picture = PICTURES[0];
		if (!picture) throw new Error("no picture");
		await expect(
			activeSoftEdtImageFormat.detect(
				new BufferByteSource(buildPicture(picture)),
			),
		).resolves.toBe(true);
		const wrongMark = buildPicture(picture);
		wrongMark.write(".TRUF", 0, "latin1");
		await expect(
			activeSoftEdtImageFormat.detect(new BufferByteSource(wrongMark)),
		).resolves.toBe(false);
	});
});
