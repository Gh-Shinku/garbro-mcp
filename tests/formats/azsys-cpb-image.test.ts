import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { deflateSync } from "node:zlib";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	azsysCpbImageFormat,
	decompressCpbChannel,
	readCpbLayout,
	unpackCpbPicture,
} from "../../packages/formats/src/azsys/cpb-image.js";

const HEAD_SIZE = 0x20;

function walkRecord(options: {
	control: Buffer;
	words?: Buffer;
	literals: Buffer;
	unpacked: number;
}): Buffer {
	const words = options.words ?? Buffer.alloc(0);
	const head = Buffer.alloc(0x14, 0x00);
	head.writeInt32LE(options.control.length, 4);
	head.writeInt32LE(words.length, 8);
	head.writeInt32LE(options.unpacked, 0x10);
	return Buffer.concat([head, options.control, words, options.literals]);
}

/** A record of four places of a picture, every place of it standing for itself. */
function recordOf(places: readonly number[]): Buffer {
	return walkRecord({
		control: Buffer.from([0x00]),
		literals: Buffer.from([places.length - 1, ...places]),
		unpacked: places.length,
	});
}

function buildPicture(options?: {
	type?: number;
	version?: number;
	bpp?: number;
	width?: number;
	height?: number;
	channels?: readonly (Buffer | number)[];
}): Buffer {
	const version = options?.version ?? 0;
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write("CPB\x1a", 0, "latin1");
	head[4] = options?.type ?? 0;
	head[5] = options?.bpp ?? 24;
	head.writeInt16LE(version, 6);
	const width = options?.width ?? 2;
	const height = options?.height ?? 2;
	if (version === 1) {
		head.writeUInt16LE(width, 0xc);
		head.writeUInt16LE(height, 0xe);
	} else {
		head.writeUInt16LE(width, 8);
		head.writeUInt16LE(height, 0xa);
	}
	const channels = options?.channels ?? [0, 0, 0, 0];
	const records: Buffer[] = [];
	for (let at = 0; at < 4; at += 1) {
		const channel = channels[at] ?? 0;
		const size = typeof channel === "number" ? 0 : channel.length;
		head.writeUInt32LE(size, 0x10 + at * 4);
		if (typeof channel !== "number") records.push(channel);
	}
	return Buffer.concat([head, ...records]);
}

describe("AZ system image format", () => {
	it("reads the head of a picture of each of the two kinds of its walk", () => {
		expect(readCpbLayout(buildPicture(), HEAD_SIZE)).toMatchObject({
			type: 0,
			version: 0,
			bitsPerPixel: 24,
			width: 2,
			height: 2,
			dataOffset: HEAD_SIZE,
		});
		expect(
			readCpbLayout(
				buildPicture({
					version: 1,
					type: 3,
					channels: [0, 0, Buffer.alloc(4), 0],
				}),
				HEAD_SIZE,
			),
		).toMatchObject({ type: 3, version: 1, channels: [0, 0, 4, 0] });
	});

	it("turns away a head that names no picture of this kind", () => {
		const wrongMark = Buffer.from(buildPicture());
		wrongMark.write("CPB\x1b", 0, "latin1");
		expect(readCpbLayout(wrongMark, HEAD_SIZE)).toBeUndefined();
		expect(readCpbLayout(buildPicture({ bpp: 8 }), HEAD_SIZE)).toBeUndefined();
		expect(readCpbLayout(buildPicture({ bpp: 16 }), HEAD_SIZE)).toBeUndefined();
		expect(
			readCpbLayout(buildPicture({ version: 2 }), HEAD_SIZE),
		).toBeUndefined();
		expect(readCpbLayout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("walks a record of the places of a picture behind the places of the walk of it", () => {
		// The first place of the picture stands for itself, and the three behind it stand for the places
		// written a moment ago, which stand within the places they stand for.
		const record = walkRecord({
			control: Buffer.from([0x40]),
			words: Buffer.from([0x00, 0x00]),
			literals: Buffer.from([0x00, 0xab]),
			unpacked: 4,
		});
		expect(decompressCpbChannel(record, 4)).toEqual(
			Buffer.from([0xab, 0xab, 0xab, 0xab]),
		);
	});

	it("turns a record that stands for more places than the picture away", () => {
		const record = walkRecord({
			control: Buffer.from([0x00]),
			literals: Buffer.from([0x01, 0x01, 0x02]),
			unpacked: 8,
		});
		expect(() => decompressCpbChannel(record, 4)).toThrow(GarbroError);
	});

	it("stands the places of the four records of a picture beside each other", async () => {
		const data = buildPicture({
			type: 3,
			channels: [
				recordOf([0x11, 0x12, 0x13, 0x14]),
				0,
				recordOf([0x21, 0x22, 0x23, 0x24]),
				0,
			],
		});
		const layout = readCpbLayout(data, data.length);
		if (!layout) throw new Error("no layout");
		expect(await unpackCpbPicture(data, layout)).toEqual(
			Buffer.from([
				0x21, 0x00, 0x11, 0x00, 0x22, 0x00, 0x12, 0x00, 0x23, 0x00, 0x13, 0x00,
				0x24, 0x00, 0x14, 0x00,
			]),
		);
	});

	it("stands a picture of the first kind out as a picture of four places", async () => {
		const data = buildPicture({
			type: 3,
			channels: [
				recordOf([0x11, 0x12, 0x13, 0x14]),
				0,
				recordOf([0x21, 0x22, 0x23, 0x24]),
				0,
			],
		});
		const handle = await azsysCpbImageFormat.open(
			new BufferByteSource(data),
			"picture.cpb",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.readInt32LE(0x12)).toBe(2);
		expect(bmp.readUInt16LE(0x1c)).toBe(32);
		expect(bmp.subarray(0x36)).toEqual(
			Buffer.from([
				0x21, 0x00, 0x11, 0x00, 0x22, 0x00, 0x12, 0x00, 0x23, 0x00, 0x13, 0x00,
				0x24, 0x00, 0x14, 0x00,
			]),
		);
	});

	it("stands a record of the second kind out of a stream of the places of a picture", async () => {
		const places = Buffer.from([0x31, 0x32, 0x33, 0x34]);
		const channel = Buffer.concat([Buffer.alloc(4, 0x00), deflateSync(places)]);
		const data = buildPicture({ version: 0, channels: [0, 0, channel, 0] });
		const layout = readCpbLayout(data, data.length);
		if (!layout) throw new Error("no layout");
		expect(await unpackCpbPicture(data, layout)).toEqual(
			Buffer.from([
				0x31, 0x00, 0x00, 0x00, 0x32, 0x00, 0x00, 0x00, 0x33, 0x00, 0x00, 0x00,
				0x34, 0x00, 0x00, 0x00,
			]),
		);
	});

	it("is told by the words of the picture", async () => {
		expect(azsysCpbImageFormat.descriptor.id).toBe("azsys-cpb-image");
		const data = buildPicture();
		await expect(
			azsysCpbImageFormat.detect(new BufferByteSource(data)),
		).resolves.toBe(true);
		const wrongMark = Buffer.from(data);
		wrongMark.write("CPB\x1b", 0, "latin1");
		await expect(
			azsysCpbImageFormat.detect(new BufferByteSource(wrongMark)),
		).resolves.toBe(false);
	});
});
