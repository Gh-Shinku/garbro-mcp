// The Circus differential picture port, against differences built in the test: the head of the difference
// (the name of the base picture beside it and the picture of the differences within the file) and two
// pictures of the engine of the walk of `tests/formats/circus-crx-image.test.ts`, one over the other. The
// places of the two pictures stand of the places of the crossing of the two of them, of the places of a
// colour of the base added to those of the difference and the places of an alpha of it less those.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, FileByteSource } from "@garbro-mcp/core";
import { crxdImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { crxdImageDescriptor } from "../../packages/formats/src/circus/crxd-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { withCompanionFiles } from "../helpers/companion.js";

interface CrxParts {
	width: number;
	height: number;
	/** The places of a place of the picture as the head names them: nothing, one, or a colour map. */
	depth: number;
	compression: number;
	flags?: number;
	mode?: number;
	offsetX?: number;
	offsetY?: number;
	palette?: Buffer;
	body: Buffer;
}

/** A picture of the Circus engine: its head, the colour map of it and the walks behind them. */
function crxFile(parts: CrxParts): Buffer {
	const head: Buffer = Buffer.alloc(0x14, 0x00);
	head.write("CRXG", 0, "latin1");
	head.writeInt16LE(parts.offsetX ?? 0, 4);
	head.writeInt16LE(parts.offsetY ?? 0, 6);
	head.writeUInt16LE(parts.width, 8);
	head.writeUInt16LE(parts.height, 0xa);
	head.writeUInt16LE(parts.compression, 0xc);
	head.writeUInt16LE(parts.flags ?? 0, 0xe);
	head.writeInt16LE(parts.depth, 0x10);
	head.writeUInt16LE(parts.mode ?? 0, 0x12);
	const body: Buffer[] = [head];
	if (parts.palette) body.push(parts.palette);
	body.push(parts.body);
	return Buffer.concat(body);
}

/** The walks of the engine, of places standing as they stand: one control place to eight of them. */
function walkLiterals(places: number[]): Buffer {
	const parts: Buffer[] = [];
	for (let at = 0; at < places.length; at += 8) {
		parts.push(Buffer.from([0xff]));
		parts.push(Buffer.from(places.slice(at, at + 8)));
	}
	return Buffer.concat(parts);
}

/**
 * The places of a picture of four places a colour as the walk of the engine stores them: the place of the
 * alpha in front of the three places of a colour, of the alpha of the picture turned over (`mode` of 0).
 */
function storedPlaces(places: readonly number[][]): number[] {
	const stored: number[] = [];
	for (const [blue, green, red, alpha] of places) {
		stored.push((alpha ?? 0) ^ 0xff, blue ?? 0, green ?? 0, red ?? 0);
	}
	return stored;
}

/** A difference of a picture: the head of it, the name of the base, and the picture of the differences. */
function crxdFile(input: {
	kind?: string;
	baseName: string;
	baseOffset?: number;
	diffOffset?: number;
	diff: Buffer;
}): Buffer {
	// The head of the difference stands of the places up to the picture of the differences itself, which
	// stands at 0x20 of the file.
	const head: Buffer = Buffer.alloc(0x20, 0x00);
	head.write("CRXD", 0, "latin1");
	head.writeUInt32LE(input.baseOffset ?? 0, 8);
	head.write(input.baseName, 0xc, "latin1");
	return Buffer.concat([head, input.diff]);
}

describe("Circus differential image", () => {
	it("stands of the places of the picture of the differences over the base", async () => {
		// A base of three places by two of a colour of its own, and a difference of two by two standing over
		// the places of the second and of the third place of every row of it.
		const base = crxFile({
			width: 3,
			height: 2,
			depth: 1,
			compression: 1,
			body: walkLiterals(
				storedPlaces([
					[0x10, 0x20, 0x30, 0x40],
					[0x11, 0x21, 0x31, 0x41],
					[0x12, 0x22, 0x32, 0x42],
					[0x13, 0x23, 0x33, 0x43],
					[0x14, 0x24, 0x34, 0x44],
					[0x15, 0x25, 0x35, 0x45],
				]),
			),
		});
		const diff = crxFile({
			width: 2,
			height: 2,
			depth: 1,
			compression: 1,
			offsetX: 1,
			body: walkLiterals(
				storedPlaces([
					[0x01, 0x02, 0x03, 0x10],
					[0x04, 0x05, 0x06, 0x11],
					[0x07, 0x08, 0x09, 0x12],
					[0x0a, 0x0b, 0x0c, 0x13],
				]),
			),
		});
		const data = crxdFile({ baseName: "base.crx", diff });
		let picture = readBmpImage(Buffer.alloc(0));
		await withCompanionFiles(
			"diff.crxd",
			{ "base.crx": base, "diff.crxd": data },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await crxdImageFormat.detect(source, mainPath)).toBe(true);
				const archive = await crxdImageFormat.open(source, mainPath);
				try {
					expect(archive.metadata).toMatchObject({
						image: "bmp",
						base: "base.crx",
						width: 2,
						height: 2,
						offsetX: 1,
						bitsPerPixel: 32,
					});
					const entry = archive.entries[0];
					if (!entry) throw new Error("no entry");
					expect(entry.path).toBe("base.bmp");
					const image = readBmpImage(
						await consumeBuffer(await archive.openEntry(entry.id)),
					);
					if (!image) throw new Error("the port handed over no bitmap");
					picture = image;
				} finally {
					await archive.close();
				}
			},
		);
		if (!picture) throw new Error("the port handed over no bitmap");
		expect(picture.width).toBe(3);
		expect(picture.height).toBe(2);
		// The places of the two pictures stand of both where they stand of the two, of the three places of a
		// colour added and the place of the alpha of the base less that of the difference.
		expect([...picture.pixels]).toEqual([
			// The first place of the row stands of the base alone.
			0x10,
			0x20,
			0x30,
			0x40,
			0x11 + 0x01,
			0x21 + 0x02,
			0x31 + 0x03,
			0x41 - 0x10,
			0x12 + 0x04,
			0x22 + 0x05,
			0x32 + 0x06,
			0x42 - 0x11,
			0x13,
			0x23,
			0x33,
			0x43,
			0x14 + 0x07,
			0x24 + 0x08,
			0x34 + 0x09,
			0x44 - 0x12,
			0x15 + 0x0a,
			0x25 + 0x0b,
			0x35 + 0x0c,
			0x45 - 0x13,
		]);
	});

	it("hands the base picture out where the two pictures stand apart", async () => {
		const base = crxFile({
			width: 1,
			height: 1,
			depth: 1,
			compression: 1,
			body: walkLiterals(storedPlaces([[0x20, 0x30, 0x40, 0x50]])),
		});
		const diff = crxFile({
			width: 1,
			height: 1,
			depth: 1,
			compression: 1,
			offsetX: 4,
			body: walkLiterals(storedPlaces([[0x01, 0x02, 0x03, 0x10]])),
		});
		const data = crxdFile({ baseName: "far.crx", diff });
		let picture = readBmpImage(Buffer.alloc(0));
		await withCompanionFiles(
			"far.crxd",
			{ "far.crx": base, "far.crxd": data },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				const archive = await crxdImageFormat.open(source, mainPath);
				try {
					const entry = archive.entries[0];
					if (!entry) throw new Error("no entry");
					const image = readBmpImage(
						await consumeBuffer(await archive.openEntry(entry.id)),
					);
					if (!image) throw new Error("the port handed over no bitmap");
					picture = image;
				} finally {
					await archive.close();
				}
			},
		);
		if (!picture) throw new Error("the port handed over no bitmap");
		expect([...picture.pixels]).toEqual([0x20, 0x30, 0x40, 0x50]);
	});

	it("stands of the base picture of the difference and of no other", async () => {
		const diff = crxFile({
			width: 1,
			height: 1,
			depth: 1,
			compression: 1,
			body: walkLiterals(storedPlaces([[0x01, 0x02, 0x03, 0x10]])),
		});
		const missing = crxdFile({ baseName: "nowhere.crx", diff });
		await withCompanionFiles(
			"missing.crxd",
			{ "missing.crxd": missing },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await crxdImageFormat.detect(source, mainPath)).toBe(true);
				await expect(crxdImageFormat.open(source, mainPath)).rejects.toThrow();
			},
		);
		// A base of three places a colour stands of another count of places than the picture of the
		// differences, which the reference turns away as well.
		const base = crxFile({
			width: 1,
			height: 1,
			depth: 0,
			compression: 1,
			body: walkLiterals(new Array(8).fill(0x00)),
		});
		const mixed = crxdFile({ baseName: "mixed.crx", diff });
		await withCompanionFiles(
			"mixed.crxd",
			{ "mixed.crx": base, "mixed.crxd": mixed },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				// The head of the difference names the places of the picture of the differences rather than
				// those of the base, so the two are held to each other where the picture is asked for.
				const archive = await crxdImageFormat.open(source, mainPath);
				try {
					const entry = archive.entries[0];
					if (!entry) throw new Error("no entry");
					await expect(archive.openEntry(entry.id)).rejects.toThrow();
				} finally {
					await archive.close();
				}
			},
		);
	});

	it("stands of no picture of the kind whose places stand behind the archive", async () => {
		// The kind `CRXJ` names the picture of the differences behind an offset of the archive of the engine,
		// where the reference reaches it through the archive it stands in: a file of its own of that kind is
		// no picture of this engine, which is where the reference stands without an archive as well.
		const diff = crxFile({
			width: 1,
			height: 1,
			depth: 1,
			compression: 1,
			body: walkLiterals(storedPlaces([[0x01, 0x02, 0x03, 0x10]])),
		});
		const head: Buffer = Buffer.alloc(0x20, 0x00);
		head.write("CRXD", 0, "latin1");
		head.write("base.crx", 0xc, "latin1");
		// The kind stands where the picture of the differences otherwise stands, and the offset of it behind
		// the head of the difference.
		const archive = Buffer.concat([head, Buffer.alloc(8, 0x00), diff]);
		archive.write("CRXJ", 0x20, "latin1");
		archive.writeUInt32LE(0x40, 0x28);
		const source = new BufferByteSource(archive);
		expect(await crxdImageFormat.detect(source, "archive.crxd")).toBe(false);
		await expect(
			crxdImageFormat.open(source, "archive.crxd"),
		).rejects.toThrow();
		expect(crxdImageDescriptor.id).toBe("circus-crxd-image");
	});
});
