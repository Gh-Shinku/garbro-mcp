import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { crc32Normal } from "@garbro-mcp/codecs";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	decodeG,
	leafGAudioFormat,
	readGAudioLayout,
} from "../../packages/formats/src/leaf/g-audio.js";

const PAGE_HEADER_SIZE = 0x1b;
const CODEC_WORD = "vorbis";

/** A page of the engine: the twenty seven bytes of an Ogg page, its table of segments and its places. */
function page(id: number | undefined, content: Buffer): Buffer {
	const header = Buffer.alloc(PAGE_HEADER_SIZE, 0x00);
	header.write("XXXX", 0, "latin1");
	header[4] = 0;
	header[5] = 2;
	header[0x1a] = 1;
	const segments = Buffer.from([
		id === undefined ? content.length : content.length + 2,
	]);
	const payload =
		id === undefined
			? content
			: Buffer.concat([Buffer.from([id, 0x5a]), content]);
	return Buffer.concat([header, segments, payload]);
}

/**
 * A sound of this engine: the pages of it. The head the reference looks at is the head of the first page
 * itself, so the page the walk begins at stands at the beginning of the file.
 */
function gFile(pages: Buffer[]): Buffer {
	return Buffer.concat(pages);
}

/** The mark of a page, worked out over the whole of it with its own four bytes standing as nought. */
function mark(page: Buffer): number {
	const copy = Buffer.from(page);
	copy.fill(0x00, 0x16, 0x1a);
	return crc32Normal(copy);
}

/** What the walk of the pages of the engine is to give for one page. */
function rebuilt(
	header: Buffer,
	codec: boolean,
	segments: Buffer,
	id: number | undefined,
	content: Buffer,
	last: boolean,
): Buffer {
	const table = Buffer.from(segments);
	if (codec) {
		if (last)
			table[table.length - 1] = ((table[table.length - 1] ?? 0) + 5) & 0xff;
		else table[0] = ((table[0] ?? 0) + 5) & 0xff;
	}
	const payload = codec
		? Buffer.concat([
				Buffer.from([id ?? 0]),
				Buffer.from("vorbis", "latin1"),
				content,
			])
		: content;
	// The walk of the pages puts the word of an Ogg page over the first four bytes of every page it gives.
	const outHeader = Buffer.from(header);
	outHeader.write("OggS", 0, "latin1");
	const out = Buffer.concat([outHeader, table, payload]);
	out.fill(0x00, 0x16, 0x1a);
	out.writeUInt32LE(mark(out) >>> 0, 0x16);
	return out;
}

const HEADER_CONTENT = Buffer.from([0x01, 0x1e]);
const COMMENT_CONTENT = Buffer.from("comment places");
const SETUP_CONTENT = Buffer.from("setup places");
const PAYLOAD_CONTENT = Buffer.from("sound places");

/** The four pages of the sound, as the engine wrote them. */
function sound(): Buffer {
	return gFile([
		page(1, HEADER_CONTENT),
		page(3, COMMENT_CONTENT),
		page(5, SETUP_CONTENT),
		page(undefined, PAYLOAD_CONTENT),
	]);
}

/** What the four pages of the sound are to give. */
function expected(): Buffer {
	const headerPage = page(1, HEADER_CONTENT);
	const commentPage = page(3, COMMENT_CONTENT);
	const setupPage = page(5, SETUP_CONTENT);
	const payloadPage = page(undefined, PAYLOAD_CONTENT);
	return Buffer.concat([
		rebuilt(
			headerPage.subarray(0, PAGE_HEADER_SIZE),
			true,
			headerPage.subarray(PAGE_HEADER_SIZE, PAGE_HEADER_SIZE + 1),
			1,
			HEADER_CONTENT,
			false,
		),
		rebuilt(
			commentPage.subarray(0, PAGE_HEADER_SIZE),
			true,
			commentPage.subarray(PAGE_HEADER_SIZE, PAGE_HEADER_SIZE + 1),
			3,
			COMMENT_CONTENT,
			false,
		),
		rebuilt(
			setupPage.subarray(0, PAGE_HEADER_SIZE),
			true,
			setupPage.subarray(PAGE_HEADER_SIZE, PAGE_HEADER_SIZE + 1),
			5,
			SETUP_CONTENT,
			true,
		),
		rebuilt(
			payloadPage.subarray(0, PAGE_HEADER_SIZE),
			false,
			payloadPage.subarray(PAGE_HEADER_SIZE, PAGE_HEADER_SIZE + 1),
			undefined,
			PAYLOAD_CONTENT,
			false,
		),
	]);
}

describe("Leaf audio format (Ogg/Vorbis)", () => {
	it("reads the head of a sound", () => {
		const data = sound();
		expect(readGAudioLayout(data, data.length)).toEqual({ pageOffset: 0 });
		// A sound of the Ogg kind as it stands is not a sound of this engine, and neither is a wave file.
		const ogg = Buffer.from(data);
		ogg.write("OggS", 0, "latin1");
		expect(readGAudioLayout(ogg)).toBeUndefined();
		const riff = Buffer.from(data);
		riff.write("RIFF", 0, "latin1");
		expect(readGAudioLayout(riff)).toBeUndefined();
		const other = Buffer.from(data);
		other[5] = 1;
		expect(readGAudioLayout(other)).toBeUndefined();
		const long = Buffer.from(data);
		long[6] = 1;
		expect(readGAudioLayout(long)).toBeUndefined();
		expect(readGAudioLayout(Buffer.alloc(4, 0x00))).toBeUndefined();
	});

	it("puts the word of the codec back into the places of the sound", () => {
		expect(decodeG(sound()).toString("hex")).toBe(expected().toString("hex"));
	});

	it("writes the mark of every page afresh", () => {
		// The marks stand over the pages the walk gives, with their own four bytes standing as nought while
		// they are worked out. The marks of the four pages are worked out by hand.
		const pages = expected();
		const lengths = [
			PAGE_HEADER_SIZE + 1 + 1 + 6 + HEADER_CONTENT.length,
			PAGE_HEADER_SIZE + 1 + 1 + 6 + COMMENT_CONTENT.length,
			PAGE_HEADER_SIZE + 1 + 1 + 6 + SETUP_CONTENT.length,
			PAGE_HEADER_SIZE + 1 + PAYLOAD_CONTENT.length,
		];
		const marks = [0x5afd9b39, 0xcf303f23, 0xcbc760cd, 0x6169105c];
		let at = 0;
		for (const [index, length] of lengths.entries()) {
			expect(pages.readUInt32LE(at + 0x16)).toBe(marks[index]);
			at += length;
		}
	});

	it("leaves a page whose bytes name no codec as it is", () => {
		// A page whose byte names neither the first, the second nor the third place is left as it stands —
		// its two places behind the byte as well — and only the word and the mark of the page are written.
		const stored = page(9, PAYLOAD_CONTENT);
		expect(decodeG(gFile([stored])).toString("hex")).toBe(
			rebuilt(
				stored.subarray(0, PAGE_HEADER_SIZE),
				false,
				stored.subarray(PAGE_HEADER_SIZE, PAGE_HEADER_SIZE + 1),
				undefined,
				Buffer.concat([Buffer.from([9, 0x5a]), PAYLOAD_CONTENT]),
				false,
			).toString("hex"),
		);
	});

	it("gives a page that is cut short as it stands", () => {
		const data = gFile([page(1, HEADER_CONTENT)]);
		const short = data.subarray(0, data.length - 3);
		const out = decodeG(short);
		// What stands at hand of the places of the page is given as it stands, with the word of the page and
		// the word of its codec written into it, and the page the walk was to give is never reached.
		// The page stands as far as the walk came: its head, its table of one segment, the byte that names
		// the place of the sound and the word of the codec, with no place of the sound behind them at all.
		expect(out.length).toBe(PAGE_HEADER_SIZE + 2 + CODEC_WORD.length);
		expect(out.subarray(0, 4).toString("latin1")).toBe("OggS");
		expect(out.subarray(-6).toString("latin1")).toBe("vorbis");
	});

	it("hands out the sound as an Ogg sound", async () => {
		const data = sound();
		const handle = await leafGAudioFormat.open(
			new BufferByteSource(data),
			"sound.g",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry).toMatchObject({
			path: "sound.ogg",
			size: BigInt(data.length),
		});
		expect(handle.metadata).toEqual({ audio: "ogg", codec: "vorbis" });
		expect(
			(await consumeBuffer(await handle.openEntry(entry.id))).toString("hex"),
		).toBe(expected().toString("hex"));
	});

	it("reads a sound only by the name of its file", async () => {
		const data = sound();
		expect(
			await leafGAudioFormat.detect(new BufferByteSource(data), "sound.g"),
		).toBe(true);
		expect(
			await leafGAudioFormat.detect(new BufferByteSource(data), "sound.bin"),
		).toBe(false);
	});

	it("declines a file that does not hold a sound", async () => {
		const other = Buffer.from(sound());
		other[5] = 1;
		await expect(
			leafGAudioFormat.open(new BufferByteSource(other), "sound.g"),
		).rejects.toThrow(GarbroError);
		await expect(
			leafGAudioFormat.open(new BufferByteSource(other), "sound.g"),
		).rejects.toThrow("Not a Leaf sound");
	});
});
