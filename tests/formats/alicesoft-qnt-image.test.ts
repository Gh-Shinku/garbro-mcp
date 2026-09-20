import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	alicesoftQntImageFormat,
	readQntLayout,
	unpackQnt,
} from "../../packages/formats/src/alicesoft/qnt-image.js";

/** A picture of four places in two rows and three places of a colour a place. The walked places of the picture
 * stand worked out with a walk of the places of the reference's own, so the places of the test stand under a
 * walk this port did not work out. */
const THREE = Buffer.from(
	"514e5400000000000100000002000000020000000200000018000000000000001100000000000000000000" +
		"0000000000789ce33af2e8b20810cb0131002df107a8",
	"hex",
);
/** What stands at the places of that picture. */
const THREE_PIXELS = Buffer.from([
	10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
]);
/** A picture of the same places and of four places of a colour a place. */
const FOUR = Buffer.from(
	"514e540000000000010000000200000002000000020000002000000000000000110000000c000000000000" +
		"0000000000789ce33af2e8b20810cb0131002df107a8789c3bf1edcd470008cf039c",
	"hex",
);
/** What stands at the places of that picture. */
const FOUR_PIXELS = Buffer.from([
	10, 20, 30, 200, 40, 50, 60, 210, 70, 80, 90, 220, 100, 110, 120, 230,
]);
/** A picture of three places in one row, which stands as places of a walk that stand beside each other of an
 * odd number of places. */
const ODD = Buffer.from(
	"514e5400000000000100000002000000030000000100000018000000000000001400000000000000000000" +
		"0000000000789c6364f80b840c0c4c509a194a03004d7e05f5",
	"hex",
);
/** What stands at the places of that picture. */
const ODD_PIXELS = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);

/** The places of a bitmap of the picture, every row of it standing in as many places as a bitmap of its kind
 * stands a row in. */
function rows(
	out: Buffer,
	width: number,
	places: number,
	height: number,
): Buffer {
	const stride = ((width * places + 3) & ~3) as number;
	const parts: Buffer[] = [];
	for (let y = 0; y < height; y += 1) {
		const at = 0x36 + y * stride;
		parts.push(out.subarray(at, at + width * places));
	}
	return Buffer.concat(parts);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await alicesoftQntImageFormat.open(
		new BufferByteSource(data),
		"picture.qnt",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("AliceSoft System image format", () => {
	it("reads the head of a picture of the first kind", () => {
		expect(readQntLayout(THREE, THREE.length)).toEqual({
			version: 0,
			width: 2,
			height: 2,
			offsetX: 1,
			offsetY: 2,
			bitsPerPixel: 24,
			headerSize: 0x30,
			rgbSize: 0x11,
			alphaSize: 0,
			alignedWidth: 2,
			alignedHeight: 2,
		});
	});

	it("turns away a head that names no picture", () => {
		const wrongVersion = Buffer.from(THREE);
		wrongVersion.writeInt32LE(3, 4);
		expect(readQntLayout(wrongVersion, wrongVersion.length)).toBeUndefined();
		const noPlaces = Buffer.from(THREE);
		noPlaces.writeUInt32LE(0, 0x10);
		expect(readQntLayout(noPlaces, noPlaces.length)).toBeUndefined();
		expect(readQntLayout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("stands the places of the picture beside the places of the walk that name them", () => {
		for (const [data, expected] of [
			[THREE, THREE_PIXELS],
			[FOUR, FOUR_PIXELS],
			[ODD, ODD_PIXELS],
		] as Array<[Buffer, Buffer]>) {
			const layout = readQntLayout(data, data.length);
			if (!layout) throw new Error("the head stands in the picture");
			const first = inflate(data, layout, 0);
			const second =
				layout.alphaSize !== 0 ? inflate(data, layout, 1) : undefined;
			expect(unpackQnt(first, second, layout)).toEqual(expected);
		}
	});

	it("hands the places of the picture to a bitmap of three places a place", async () => {
		const out = await extract(THREE);
		expect(out.readUInt32LE(0x12)).toBe(2);
		expect(out.readInt32LE(0x16)).toBe(-2);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		expect(rows(out, 2, 3, 2)).toEqual(THREE_PIXELS);
	});

	it("hands the places of the picture to a bitmap of four places a place", async () => {
		const out = await extract(FOUR);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(rows(out, 2, 4, 2)).toEqual(FOUR_PIXELS);
		const handle = await alicesoftQntImageFormat.open(
			new BufferByteSource(FOUR),
			"picture.qnt",
		);
		expect(handle.metadata).toMatchObject({ bitsPerPixel: 32 });
	});

	it("reads the head of a picture of the other kinds", async () => {
		// The kinds of the head that stand behind the first one name the words of the head behind a size of
		// their own; the places of the picture of the test stand where the first kind names them.
		const data = Buffer.from(THREE);
		data.writeInt32LE(2, 4);
		data.writeInt32LE(0x30, 8);
		data.writeInt32LE(1, 0x0c);
		data.writeInt32LE(2, 0x10);
		data.writeUInt32LE(2, 0x14);
		data.writeUInt32LE(2, 0x18);
		data.writeInt32LE(24, 0x1c);
		data.writeUInt32LE(0x11, 0x24);
		data.writeUInt32LE(0, 0x28);
		const layout = readQntLayout(data, data.length);
		expect(layout).toMatchObject({ version: 2, headerSize: 0x30, width: 2 });
		const handle = await alicesoftQntImageFormat.open(
			new BufferByteSource(data),
			"picture.qnt",
		);
		expect(handle.metadata).toMatchObject({ version: 2, bitsPerPixel: 24 });
		expect(
			rows(
				await consumeBuffer(
					await handle.openEntry(handle.entries[0]?.id ?? ""),
				),
				2,
				3,
				2,
			),
		).toEqual(THREE_PIXELS);
	});

	it("turns a picture cut short of the places of its walk away", async () => {
		const cut = Buffer.from(THREE.subarray(0, THREE.length - 4));
		await expect(extract(cut)).rejects.toThrow(GarbroError);
	});

	it("is told by the words of the picture", async () => {
		expect(alicesoftQntImageFormat.descriptor.id).toBe("alicesoft-qnt-image");
		expect(alicesoftQntImageFormat.detection).toEqual({
			signatures: [{ bytes: Buffer.from("QNT", "latin1") }],
		});
		await expect(
			alicesoftQntImageFormat.detect(new BufferByteSource(THREE)),
		).resolves.toBe(true);
		const wrongMark = Buffer.from(THREE);
		wrongMark.write("QNX", 0, "latin1");
		await expect(
			alicesoftQntImageFormat.detect(new BufferByteSource(wrongMark)),
		).resolves.toBe(false);
	});
});

/** The places the walk of a picture stands for, read as the reference reads them. */
function inflate(
	data: Buffer,
	layout: ReturnType<typeof readQntLayout>,
	part: number,
): Buffer {
	if (!layout) throw new Error("no layout");
	const at = layout.headerSize + (0 === part ? 0 : layout.rgbSize);
	const size =
		0 === part
			? layout.alignedHeight * layout.alignedWidth * 3
			: layout.alignedWidth * layout.height;
	const { inflateSync } = require("node:zlib") as typeof import("node:zlib");
	return inflateSync(data.subarray(at, data.length)).subarray(0, size);
}
