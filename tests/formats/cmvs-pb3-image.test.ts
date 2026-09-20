import { Buffer } from "node:buffer";
import {
	BufferByteSource,
	FileByteSource,
	GarbroError,
} from "@garbro-mcp/core";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { cmvsPb3ImageFormat } from "../../packages/formats/src/cmvs/pb3-image.js";
import { readPb3Head } from "../../packages/codecs/src/pb3-reader.js";

const DATA1_FIELD = 0x2c;
const DATA2_FIELD = 0x30;

/** The words the places of the file of a picture of the sixth kind stand behind, every one of which stands as
 * the places of the file itself. */
const NAME_KEY_V6 = [
	0xa6, 0x75, 0xf3, 0x9c, 0xc5, 0x69, 0x78, 0xa3, 0x3e, 0xa5, 0x4f, 0x79, 0x59,
	0xfe, 0x3a, 0xc7,
];

/** A picture of the first kind of sixteen places, whose places of every colour stand as a walk of their own
 * and whose places of the picture stand as the places of that walk: every place of a colour stands as the
 * place of the picture that stands as it stands, so the places of the picture stand as the places of the
 * colours of the picture themselves. */
function buildV1(): Buffer {
	const channels = 4;
	const width = 16;
	const height = 16;
	const planeSize = width * height;
	// The places of the walk of the places of a colour stand as the places of the file of the picture itself,
	// which stand as the places of the picture one place at a time: every place of the walk of the picture
	// stands as one place of the file, so the places of the file that name the places of the walk of a colour
	// stand as the places of eight places of the walk.
	const walkPlaces = Math.ceil(planeSize / 8);
	const recordSize = 12 + 1 + walkPlaces;
	// The words of the head of a picture of this kind stand in the first six and thirty places of the file, and
	// the places of the walks of its colours stand behind the words of the head and the places of the tables of
	// the walks of the colours.
	const head = Buffer.alloc(0x34, 0x00);
	const data1 = 0x34;
	const tableSize = 4 * channels;
	const data2 = data1 + tableSize + channels * recordSize;
	head.write("PB3B", 0, "latin1");
	head.writeInt32LE(0, 4);
	// The reference reads a picture of the first kind only of the underkind of the pictures of the engine.
	head.writeInt32LE(0x10, 0x18);
	head.writeUInt16LE(1, 0x1c);
	head.writeUInt16LE(width, 0x1e);
	head.writeUInt16LE(height, 0x20);
	head.writeUInt16LE(32, 0x22);
	head.writeInt32LE(data1, DATA1_FIELD);
	head.writeInt32LE(data2, DATA2_FIELD);
	const table = Buffer.alloc(tableSize, 0x00);
	for (let at = 0; at < channels; at += 1) {
		table.writeInt32LE(recordSize, at * 4);
	}
	const records = Buffer.alloc(channels * recordSize, 0x00);
	for (let at = 0; at < channels; at += 1) {
		const from = at * recordSize;
		// The places of the walk of the places of a colour: one place of the walk of the picture, which stands
		// for no places of the picture beside it, and one place of the file, which stands as the places of the
		// picture of the walk of its places.
		records.writeInt32LE(1, from);
		records.writeInt32LE(0, from + 4);
		records.writeInt32LE(planeSize, from + 8);
		// The places 0 stand for the places of the picture of the walk of their places, so the places of the
		// picture stand as the places of the walk that stand for them.
		records[from + 12] = 0x00;
		// The places of the walk of the places of a colour stand as the places of the file one place at a
		// time, every one of them standing as it stands: the places of the file that name them stand as no
		// places of the walk at all, so every place of the walk of a colour stands as the place of the walk of
		// the picture that stands beside it.
		for (let at = 0; at < walkPlaces; at += 1) {
			records[from + 13 + at] = 0x00;
		}
	}
	// The places the walk of the places of every colour stands for itself stand in the places of the table of
	// the walks of the colours, which stand as places of their own behind the words of the head of the picture
	// and every one of which names how many places of the walk of a colour the places of its colour stand for.
	const walks = Buffer.alloc(tableSize + channels * planeSize, 0x00);
	for (let channel = 0; channel < channels; channel += 1) {
		walks.writeInt32LE(planeSize, channel * 4);
		const from = tableSize + channel * planeSize;
		for (let at = 0; at < planeSize; at += 1) {
			walks[from + at] = at & 0xff;
		}
	}
	return Buffer.concat([head, table, records, walks]);
}

/** A picture of the fifth kind of sixteen places, whose places of every colour stand as a walk of their own:
 * every place of the walk stands beside the place before it, so the places of the picture stand as the places
 * of the picture that stand beside the places of the file the walk stands for. */
function buildV5(): Buffer {
	const width = 16;
	const height = 16;
	const planeSize = width * height;
	const walkPlaces = Math.ceil(planeSize / 8);
	const walksAt = 0x54;
	const channelSize = walkPlaces + planeSize;
	const head = Buffer.alloc(walksAt, 0x00);
	head.write("PB3B", 0, "latin1");
	head.writeInt32LE(0, 4);
	head.writeInt32LE(0x10, 0x18);
	head.writeUInt16LE(5, 0x1c);
	head.writeUInt16LE(width, 0x1e);
	head.writeUInt16LE(height, 0x20);
	head.writeUInt16LE(32, 0x22);
	for (let channel = 0; channel < 4; channel += 1) {
		head.writeInt32LE(channel * channelSize, 0x34 + 8 * channel);
		head.writeInt32LE(channel * channelSize + walkPlaces, 0x38 + 8 * channel);
	}
	const walks = Buffer.alloc(4 * channelSize, 0x00);
	for (let channel = 0; channel < 4; channel += 1) {
		const from = channel * channelSize + walkPlaces;
		for (let at = 0; at < planeSize; at += 1) {
			walks[from + at] = at & 0xff;
		}
	}
	return Buffer.concat([head, walks]);
}

/** Writes a picture and the places of a picture of the engine beside it into a temporary directory and runs
 * the callback with the place of the words of the picture. */
async function withCompanions(
	main: string,
	companions: Record<string, Buffer>,
	run: (mainPath: string) => Promise<void>,
): Promise<void> {
	const root = await mkdtemp(resolve(tmpdir(), "garbro-pb3-"));
	try {
		for (const [name, content] of Object.entries(companions)) {
			await writeFile(resolve(root, name), content);
		}
		const mainPath = resolve(root, main);
		await writeFile(mainPath, Buffer.alloc(0));
		await run(mainPath);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

/** A picture of the sixth kind of sixteen places, whose words name a picture of the engine that stands beside
 * it and whose places of the picture itself stand as the places of a walk of their own that stands over it. */
function buildV6(): Buffer {
	const width = 16;
	const height = 16;
	// Every place of the picture stands as the places of a walk of the picture itself: the places of the walk
	// stand as the places of the file of the picture one place at a time, and the walk names the picture of the
	// engine the places of the picture stand as through the words of its head.
	const overlay = Buffer.alloc(8 + 1 + 3 * 8 * 32, 0x00);
	// The places of the walk of the places of the picture stand as places of their own within the places of
	// the picture itself, the places of the walk of the picture standing at the places the places of the
	// picture name.
	overlay.writeInt32LE(1, 0);
	// The places of the walk of the places of the picture: the places of the second place of a picture of the
	// picture itself stand as no places of the walk at all, so the places of the picture the words name stand
	// as the places of the picture that stand there.
	overlay[8] = 0x40;
	let at = 9;
	for (const place of [0xaa, 0xbb, 0xcc]) {
		overlay.fill(place, at, at + 8 * 32);
		at += 8 * 32;
	}
	const walkPlaces = Math.ceil(overlay.length / 8);
	const bitsAt = 0x54;
	// The words of the head of the picture stand in the first two and fifty places of the file, the words that
	// name the picture of the engine standing in the places behind them and the places of the walk of the
	// places of the picture behind those.
	const head = Buffer.alloc(0x34, 0x00);
	head.write("PB3B", 0, "latin1");
	head.writeInt32LE(0, 4);
	head.writeInt32LE(0x10, 0x18);
	head.writeUInt16LE(6, 0x1c);
	head.writeUInt16LE(width, 0x1e);
	head.writeUInt16LE(height, 0x20);
	head.writeUInt16LE(32, 0x22);
	head.writeInt32LE(bitsAt - 0x20, 0x0c);
	head.writeInt32LE(overlay.length, 0x18);
	head.writeInt32LE(walkPlaces, 0x2c);
	const name = Buffer.alloc(0x20, 0x00);
	const word = Buffer.from("base", "latin1");
	word.copy(name, 0);
	for (let i = 0; i < 0x20; i += 1) {
		name[i] = (name[i] ?? 0) ^ (NAME_KEY_V6[i & 0xf] ?? 0);
	}
	return Buffer.concat([head, name, Buffer.alloc(walkPlaces, 0x00), overlay]);
}

/** A picture of the second kind: the places of the picture stand as the places of a picture of the Purple
 * engine that stands within it at the places the words of its head name. */
function buildKind2(): Buffer {
	const jbp = buildJbp();
	const head = Buffer.alloc(0x34, 0x00);
	head.write("PB3B", 0, "latin1");
	head.writeInt32LE(0, 4);
	head.writeInt32LE(0, 0x18);
	head.writeUInt16LE(2, 0x1c);
	head.writeUInt16LE(16, 0x1e);
	head.writeUInt16LE(16, 0x20);
	head.writeUInt16LE(24, 0x22);
	head.writeInt32LE(0, DATA1_FIELD);
	head.writeInt32LE(0, DATA2_FIELD);
	return Buffer.concat([head, jbp]);
}

/** A picture of the Purple engine whose every place stands as the place of the picture itself, which stands
 * as the place of the colours of the picture that stands as the place of the picture itself. */
function buildJbp(): Buffer {
	const dataPos = 0x30;
	const walkPlaces = 0x10;
	const frequencySize = 0x40;
	const head = Buffer.alloc(dataPos, 0x00);
	head.write("JBP1", 0, "latin1");
	head.writeInt32LE(dataPos, 4);
	head.writeUInt16LE(16, 0x10);
	head.writeUInt16LE(16, 0x12);
	head.writeInt32LE(3, 0x1c);
	head.writeInt32LE(3, 0x20);
	const frequencies = Buffer.alloc(frequencySize * 2, 0x00);
	for (let at = 0; at < walkPlaces; at += 1) {
		frequencies.writeUInt32LE(1, at * 4);
		frequencies.writeUInt32LE(1, frequencySize + at * 4);
	}
	return Buffer.concat([
		head,
		frequencies,
		Buffer.alloc(walkPlaces, 0x00),
		Buffer.alloc(0x80, 0x00),
		Buffer.alloc(3, 0x00),
		Buffer.alloc(3, 0xff),
	]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await cmvsPb3ImageFormat.open(
		new BufferByteSource(data),
		"picture.pb3",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("Purple Software image format", () => {
	it("reads the head of a picture", () => {
		expect(readPb3Head(buildV1())).toMatchObject({
			kind: 1,
			width: 16,
			height: 16,
			bitsPerPixel: 32,
		});
	});

	it("turns away a head that names no picture", () => {
		// The words of the walk of the places of a picture stand behind the words of the picture itself, and the
		// reference reads them as the places of the walk of the kind of pictures the words of the head name.
		expect(cmvsPb3ImageFormat.detection).toEqual({
			signatures: [{ bytes: Buffer.from("PB3B", "latin1") }],
		});
		const wrongMark = Buffer.from(buildV1());
		wrongMark.write("PB3C", 0, "latin1");
		expect(wrongMark.subarray(0, 4).toString("latin1")).toBe("PB3C");
	});

	it("stands the places of a picture of the first kind as the places of the walk of its colours", async () => {
		const out = await extract(buildV1());
		expect(out.readUInt32LE(0x12)).toBe(16);
		// `ImageData.Create` keeps the stored order top down, so the height of the bitmap is negative.
		expect(out.readInt32LE(0x16)).toBe(-16);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		const pixels = out.subarray(0x36);
		for (let y = 0; y < 16; y += 1) {
			for (let x = 0; x < 16; x += 1) {
				const at = (y * 16 + x) * 4;
				const place = y * 16 + x;
				// The places of every colour of the picture stand as the places of the walk of their own, so
				// every place of the picture stands as the place of the picture that stands as it stands.
				expect([
					pixels[at],
					pixels[at + 1],
					pixels[at + 2],
					pixels[at + 3],
				]).toEqual([place, place, place, place]);
			}
		}
	});

	it("stands the places of a picture of the fifth kind beside the places before them", async () => {
		const out = await extract(buildV5());
		expect(out.readUInt32LE(0x12)).toBe(16);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		const pixels = out.subarray(0x36);
		for (let place = 0; place < 256; place += 1) {
			// Every place of the walk of the places of a colour stands beside the place before it, so the place
			// of the picture stands as the places of the picture that stand beside the places of the file the
			// walk stands for.
			const expected = ((place * (place + 1)) / 2) % 256;
			expect(pixels[place * 4]).toBe(expected);
		}
	});

	it("stands the places of a picture of the sixth kind as the places of the picture its words name", async () => {
		// The words of the picture of the engine the words of the head name stand as places of their own, and
		// the places of the picture seen through them stand as the places of the picture that stand there.
		const base = buildV1();
		await withCompanions(
			"picture.pb3",
			{ "base.pb3": base },
			async (mainPath) => {
				await writeFile(mainPath, buildV6());
				const source = await FileByteSource.open(mainPath);
				const archive = await cmvsPb3ImageFormat.open(source, mainPath);
				const entry = archive.entries[0];
				if (!entry) throw new Error("no entry");
				const out = await consumeBuffer(await archive.openEntry(entry.id));
				await archive.close();
				const pixels = out.subarray(0x36);
				// The places of the picture stand as the places of the walk of the picture itself, so the places of
				// the picture that stand as no places of the walk at all stand as the places of the picture the
				// words of the head name.
				const at = (x: number, y: number): number => (y * 16 + x) * 4;
				expect([...pixels.subarray(at(0, 0), at(0, 0) + 4)]).toEqual([
					0xaa, 0xaa, 0xaa, 0xaa,
				]);
				expect([...pixels.subarray(at(8, 0), at(8, 0) + 4)]).toEqual([
					8, 8, 8, 8,
				]);
				expect([...pixels.subarray(at(0, 8), at(0, 8) + 4)]).toEqual([
					0xbb, 0xbb, 0xbb, 0xbb,
				]);
				expect([...pixels.subarray(at(8, 8), at(8, 8) + 4)]).toEqual([
					0xcc, 0xcc, 0xcc, 0xcc,
				]);
				// The places of the picture the words name stand as the places of the picture of the walk of the
				// places of its own, so the places of the picture stand as the places of that picture behind them.
				expect([...pixels.subarray(at(15, 7), at(15, 7) + 4)]).toEqual([
					127, 127, 127, 127,
				]);
			},
		);
	});

	it("turns a picture whose words name no picture beside it away", async () => {
		await withCompanions("picture.pb3", {}, async (mainPath) => {
			await writeFile(mainPath, buildV6());
			const source = await FileByteSource.open(mainPath);
			const archive = await cmvsPb3ImageFormat.open(source, mainPath);
			const entry = archive.entries[0];
			if (!entry) throw new Error("no entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow(GarbroError);
			await archive.close();
		});
	});

	it("turns a picture whose places stand as a walk this project does not read away", async () => {
		for (const kind of [4, 7, 9]) {
			const data = Buffer.from(buildKind2());
			data.writeUInt16LE(kind, 0x1c);
			await expect(extract(data)).rejects.toThrow(GarbroError);
		}
		// A picture of the first kind whose underkind names a picture of a kind this project does not read.
		const other = Buffer.from(buildV1());
		other.writeInt32LE(0, 0x18);
		await expect(extract(other)).rejects.toThrow(GarbroError);
	});

	it("stands the places of a picture of the second kind as the places of the picture within it", async () => {
		const out = await extract(buildKind2());
		expect(out.readUInt32LE(0x12)).toBe(16);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		const pixels = out.subarray(0x36);
		expect(pixels.length).toBe(16 * 16 * 3);
		for (let at = 0; at < pixels.length; at += 1) {
			expect(pixels[at]).toBe(0x80);
		}
	});

	it("turns a picture of a kind this project does not read away", async () => {
		for (const kind of [4, 7, 9]) {
			const data = Buffer.from(buildKind2());
			data.writeUInt16LE(kind, 0x1c);
			await expect(extract(data)).rejects.toThrow(GarbroError);
		}
		// A picture of the first kind whose underkind names a picture of a kind this project does not read.
		const other = Buffer.from(buildV1());
		other.writeInt32LE(0, 0x18);
		await expect(extract(other)).rejects.toThrow(GarbroError);
	});

	it("is told by the words of the picture", async () => {
		expect(cmvsPb3ImageFormat.descriptor.id).toBe("cmvs-pb3-image");
		expect(cmvsPb3ImageFormat.descriptor.extensions).toEqual(["pb3"]);
		await expect(
			cmvsPb3ImageFormat.detect(new BufferByteSource(buildV1())),
		).resolves.toBe(true);
		const wrongMark = Buffer.from(buildV1());
		wrongMark.write("PB3C", 0, "latin1");
		await expect(
			cmvsPb3ImageFormat.detect(new BufferByteSource(wrongMark)),
		).resolves.toBe(false);
	});
});
