import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { nononoNpfFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const DEFAULT_SEED = 0x46415420; // 'FAT '
const HEADER_OFFSET = 12;
const HEADER_SIZE = 20;
const INDEX_OFFSET = 0x20;
const RECORD_SIZE = 20;

/** Test-side copy of the first generator the reference tries. */
class Generator1 {
	#seed: number;

	constructor(seed = DEFAULT_SEED) {
		this.#seed = 0;
		this.srand(seed);
	}

	srand(seed: number): void {
		this.#seed = seed | 0;
		for (let i = 0; i < 32; i += 1) this.rand();
	}

	rand(): number {
		this.#seed = (this.#seed ^ 0x65ac9365) | 0;
		const left = ((this.#seed >> 1) ^ this.#seed) >> 3;
		const right = ((this.#seed << 1) ^ this.#seed) << 3;
		this.#seed = (this.#seed ^ (left ^ right)) | 0;
		return this.#seed;
	}
}

/** Test-side copy of the second generator the reference tries. */
class Generator2 {
	#seed1 = 0;
	#seed2 = 0;

	constructor(seed = DEFAULT_SEED) {
		this.srand(seed);
	}

	srand(seed: number): void {
		this.#seed1 = seed | 0;
		this.#seed2 = (((seed >> 12) ^ (seed << 18)) - 0x579e2b8d) | 0;
	}

	rand(): number {
		const next =
			(this.#seed2 + ((this.#seed1 >> 10) ^ (this.#seed1 << 14))) | 0;
		this.#seed2 =
			(next - 0x15633649 + ((this.#seed2 >> 12) ^ (this.#seed2 << 18))) | 0;
		return this.#seed2;
	}
}

interface Generator {
	srand(seed: number): void;
	rand(): number;
}

/** Mirrors the reference's decryption, which is its own inverse. */
function crypt(data: Buffer, generator: Generator): Buffer {
	const output = Buffer.from(data);
	for (let i = 0; i < output.length; i += 1)
		output[i] = ((output[i] ?? 0) ^ (generator.rand() & 0xff)) & 0xff;
	return output;
}

interface Fixture {
	name: string;
	content: Buffer;
}

/** Seeds that stay inside the signed 32-bit range, including one negative value. */
function seedFor(index: number): number {
	return 0x1111 * (index + 1) - (index === 1 ? 0x20000 : 0);
}

/** Builds an archive the way the reference reads it, with the given generator. */
function buildNpf(fixtures: readonly Fixture[], kind: 1 | 2): Buffer {
	const generator: Generator = kind === 2 ? new Generator2() : new Generator1();
	const names = fixtures.map((fixture) => encodeCp932(fixture.name));
	const nameSize = names.reduce((sum, name) => sum + name.length, 0);
	const payloadStart = INDEX_OFFSET + fixtures.length * RECORD_SIZE + nameSize;

	const header = Buffer.alloc(HEADER_SIZE);
	header.write("FAT ", 0, "latin1");
	header.writeInt32LE(fixtures.length, 8);
	const encryptedHeader = crypt(header, generator);

	const records = Buffer.alloc(fixtures.length * RECORD_SIZE);
	const payloads: Buffer[] = [];
	let payloadOffset = payloadStart;
	for (const [index, fixture] of fixtures.entries()) {
		const seed = seedFor(index);
		const cursor = index * RECORD_SIZE;
		records.writeInt32LE(seed, cursor + 8);
		records.writeInt32LE(names[index]?.length ?? 0, cursor + 12);
		records.writeUInt32LE(payloadOffset, cursor + 4);
		records.writeUInt32LE(fixture.content.length, cursor + 16);
		payloadOffset += fixture.content.length;
		const payload = Buffer.from(fixture.content);
		generator.srand(seed);
		payloads.push(crypt(payload, generator));
	}
	generator.srand(fixtures.length);
	const encryptedIndex = crypt(records, generator);

	const encryptedNames = names.map((name, index) => {
		generator.srand(seedFor(index));
		return crypt(name, generator);
	});

	const file = Buffer.alloc(payloadOffset);
	file.writeInt32LE(0x4b434150, 0); // 'PACK'
	file.writeInt32LE(4, 4);
	file.writeInt32LE(1, 8);
	encryptedHeader.copy(file, HEADER_OFFSET);
	encryptedIndex.copy(file, INDEX_OFFSET);
	let cursor = INDEX_OFFSET + fixtures.length * RECORD_SIZE;
	for (const name of encryptedNames) {
		name.copy(file, cursor);
		cursor += name.length;
	}
	let payloadCursor = payloadStart;
	for (const payload of payloads) {
		payload.copy(file, payloadCursor);
		payloadCursor += payload.length;
	}
	return file;
}

const ENTRIES: Fixture[] = [
	{ name: "first.bin", content: Buffer.from("first payload") },
	{ name: "sub\\second.dat", content: Buffer.from("second payload here") },
	{ name: "背景.cg", content: Buffer.from("third payload") },
];

const EXPECTED = [
	{ path: "first.bin", size: 13, content: Buffer.from("first payload") },
	{
		path: "sub/second.dat",
		size: 19,
		content: Buffer.from("second payload here"),
	},
	{ path: "背景.cg", size: 13, content: Buffer.from("third payload") },
];

/** The head of the picture a walk of the engine of this kind unfolds: the places of the file of the head
 * of a bitmap of four places of the file, then its places. */
function imgxPicture(input: {
	width: number;
	height: number;
	bitsPerPixel: number;
	pixels: Buffer;
	palette?: Buffer;
}): Buffer {
	const head: Buffer = Buffer.alloc(0x36, 0x00);
	head.writeInt32LE(0x36, 0);
	head.writeUInt32LE(input.width, 4);
	head.writeUInt32LE(input.height, 8);
	head.writeUInt16LE(input.bitsPerPixel, 0x0e);
	head.writeInt32LE(input.palette ? input.palette.length / 4 : 0, 0x20);
	return Buffer.concat([head, input.palette ?? Buffer.alloc(0), input.pixels]);
}

/** The other direction of `ImgXDecoder.Unpack`, of the counts of the places of the file: every place of the
 * file stands as its own count of the walk, and the count that ends the walk stands behind them. */
function imgxStream(unpacked: Buffer): Buffer {
	const head = Buffer.alloc(8, 0x00);
	head.write("IMGX", 0, "latin1");
	const rotated = ((unpacked.length << 16) | (unpacked.length >>> 16)) >>> 0;
	head.writeUInt32LE(~rotated >>> 0, 4);
	const codes = [...unpacked, 0x100];
	const places: number[] = [];
	for (const code of codes) {
		for (let at = 0; at < 9; at += 1) places.push((code >> at) & 1);
	}
	const body: Buffer = Buffer.alloc(Math.ceil(places.length / 8), 0x00);
	for (const [at, bit] of places.entries()) {
		// The walk of this engine takes the least significant place of every byte of the file first.
		if (bit !== 0) body[at >> 3] = (body[at >> 3] ?? 0) | (1 << (at & 7));
	}
	return Buffer.concat([head, body]);
}

async function contentOf(archive: Buffer, at: number): Promise<Buffer> {
	const handle = await nononoNpfFormat.open(
		new BufferByteSource(archive),
		"sample.npf",
	);
	try {
		const entry = handle.entries[at];
		if (!entry) throw new Error("no entry");
		return consumeBuffer(await handle.openEntry(entry.id));
	} finally {
		await handle.close();
	}
}

async function expectDeclined(archive: Buffer): Promise<void> {
	const source = new BufferByteSource(archive);
	expect(await nononoNpfFormat.detect(source, "sample.npf")).toBe(false);
}

describe("NGS engine resource archive", () => {
	it("lists and extracts an archive of the first generator", async () => {
		await expectArchive({
			format: nononoNpfFormat,
			archive: buildNpf(ENTRIES, 1),
			entries: EXPECTED,
			metadata: { entryCount: 3 },
		});
	});

	it("lists and extracts an archive of the second generator", async () => {
		await expectArchive({
			format: nononoNpfFormat,
			archive: buildNpf(ENTRIES, 2),
			entries: EXPECTED,
			metadata: { entryCount: 3 },
		});
	});

	it("reads the picture of a resource of the engine itself", async () => {
		// `NpfOpener.OpenImage` hands an entry that opens with the word `IMGX` to `ImgXDecoder`, whose walk of
		// the bits unfolds the head of a picture and its places; the entry itself stands of no picture of its
		// own. The picture of this fixture is two places square, of four places of the file a place.
		const picture = imgxPicture({
			width: 2,
			height: 2,
			bitsPerPixel: 32,
			pixels: Buffer.from([
				10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 64, 100, 110, 120, 32,
			]),
		});
		const archive = buildNpf(
			[{ name: "art.imgx", content: imgxStream(picture) }],
			1,
		);
		const image = readBmpImage(await contentOf(archive, 0));
		if (!image) throw new Error("the resource is not a bitmap");
		expect([image.width, image.height]).toEqual([2, 2]);
		expect([...image.pixels]).toEqual([
			10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 64, 100, 110, 120, 32,
		]);
		// A picture of a palette of its own stands as a picture of one place of the file.
		const palette = Buffer.alloc(4 * 4, 0x00);
		palette[4] = 0x11;
		palette[5] = 0x22;
		palette[6] = 0x33;
		const indexed = imgxPicture({
			width: 2,
			height: 1,
			bitsPerPixel: 8,
			palette,
			pixels: Buffer.from([1, 0]),
		});
		const paletted = readBmpImage(
			await contentOf(
				buildNpf([{ name: "art.imgx", content: imgxStream(indexed) }], 2),
				0,
			),
		);
		if (!paletted) throw new Error("the resource is not a bitmap");
		expect(paletted.bitsPerPixel).toBe(8);
	});

	it("turns away a resource of the engine that stands of no picture of its own", async () => {
		// The word of the walk stands there, but what unfolds is no head of a picture.
		const stray = Buffer.concat([
			Buffer.from("IMGX", "latin1"),
			Buffer.alloc(4, 0x00),
			Buffer.alloc(0x40, 0x11),
		]);
		const archive = buildNpf([{ name: "art.imgx", content: stray }], 1);
		await expect(contentOf(archive, 0)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});

	it("rejects an archive without entries", async () => {
		await expectDeclined(buildNpf([], 1));
	});

	it("rejects a file with a different format version", async () => {
		const archive = buildNpf(ENTRIES, 1);
		archive.writeInt32LE(5, 4);
		await expectDeclined(archive);
	});

	it("rejects an archive whose payloads leave the file", async () => {
		const archive = buildNpf(ENTRIES, 1);
		await expectDeclined(archive.subarray(0, archive.length - 4));
	});

	it("rejects a file that is not an archive at all", async () => {
		await expectDeclined(Buffer.from("PACK\0\0\0\0\0\0\0\0"));
	});
});
