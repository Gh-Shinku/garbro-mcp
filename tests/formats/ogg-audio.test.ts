import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { crc32Normal } from "@garbro-mcp/codecs";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	oggAudioFormat,
	oggPagesValid,
	readOggLayout,
	restoreOggCrc,
} from "../../packages/formats/src/ogg/ogg-audio.js";

const PAGE_HEAD = 0x1b;
const CRC_AT = 0x16;

function oggPage(
	body: Buffer,
	options: { crc?: number; sequence?: number } = {},
): Buffer {
	const segments: number[] = [];
	let left = body.length;
	while (left > 255) {
		segments.push(255);
		left -= 255;
	}
	segments.push(left);
	const page = Buffer.concat([
		Buffer.from("OggS", "latin1"),
		Buffer.alloc(1, 0x00),
		Buffer.alloc(1, 0x00),
		Buffer.alloc(8, 0x00),
		Buffer.alloc(4, 0x00),
		(() => {
			const out = Buffer.alloc(4, 0x00);
			out.writeUInt32LE(options.sequence ?? 0, 0);
			return out;
		})(),
		Buffer.alloc(4, 0x00),
		Buffer.from([segments.length]),
		Buffer.from(segments),
		body,
	]);
	const computed = crc32Normal(page, 0);
	page.writeUInt32LE(options.crc ?? computed, CRC_AT);
	return page;
}

function body(size: number, byte: number): Buffer {
	return Buffer.alloc(size, byte);
}

describe("Ogg/Vorbis audio format", () => {
	it("reads the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of the places of the picture of their own", () => {
		const page = oggPage(body(16, 0xaa));
		const layout = readOggLayout(page);
		if (!layout) throw new Error("no layout");
		expect(layout.wrapped).toBe(false);
		expect(layout.oggAt).toBe(0);
		expect(layout.trailing).toBe(0);
		expect(layout.pages.length).toBe(1);
		expect(layout.pages[0]?.length).toBe(PAGE_HEAD + 1 + 16);
		expect(oggPagesValid(layout)).toBe(true);
		expect(layout.ogg.length).toBe(page.length);
	});

	it("reads the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture", () => {
		const first = oggPage(body(300, 0x01));
		const second = oggPage(body(8, 0x02), { sequence: 1 });
		const layout = readOggLayout(Buffer.concat([first, second]));
		if (!layout) throw new Error("no layout");
		expect(layout.pages.length).toBe(2);
		expect(layout.pages[0]?.length).toBe(PAGE_HEAD + 2 + 300);
		expect(layout.pages[1]?.at).toBe(first.length);
		expect(oggPagesValid(layout)).toBe(true);
	});

	it("stands the places of the picture of the walk of the places of the picture of the words of the walk of the picture of the places of the picture of the walk of the places of the picture of the places of the picture of the walk of the places of the picture of the fifth kind of the places of the picture of the walk of the places of the picture of their own", () => {
		const broken = oggPage(body(16, 0xaa), { crc: 0x12345678 });
		const second = oggPage(body(8, 0x02), { crc: 0xdeadbeef, sequence: 1 });
		const file = Buffer.concat([broken, second]);
		const layout = readOggLayout(file);
		if (!layout) throw new Error("no layout");
		expect(oggPagesValid(layout)).toBe(false);
		expect(layout.pages[0]?.stored).toBe(0x12345678);
		expect(layout.pages[0]?.computed).not.toBe(0x12345678);
		const restored = restoreOggCrc(layout);
		const fixed = readOggLayout(restored);
		if (!fixed) throw new Error("no fixed layout");
		expect(oggPagesValid(fixed)).toBe(true);
		expect(restored.length).toBe(file.length);
		expect(restored.readUInt32LE(CRC_AT)).toBe(layout.pages[0]?.computed);
	});

	it("reads the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of the places of the picture of the sound inside a picture of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of them of the engine", () => {
		const page = oggPage(body(16, 0xaa));
		const fmt = Buffer.alloc(0x10, 0x00);
		fmt.writeUInt16LE(0x676f, 0);
		const riff = Buffer.concat([
			Buffer.from("RIFF", "latin1"),
			Buffer.from([0x00, 0x00, 0x00, 0x00]),
			Buffer.from("WAVEfmt ", "latin1"),
			(() => {
				const out = Buffer.alloc(4, 0x00);
				out.writeUInt32LE(fmt.length, 0);
				return out;
			})(),
			fmt,
			Buffer.from("data", "latin1"),
			(() => {
				const out = Buffer.alloc(4, 0x00);
				out.writeUInt32LE(page.length, 0);
				return out;
			})(),
			page,
		]);
		const layout = readOggLayout(riff);
		if (!layout) throw new Error("no layout");
		expect(layout.wrapped).toBe(true);
		expect(layout.oggAt).toBe(riff.length - page.length);
		expect(layout.ogg.equals(page)).toBe(true);
		expect(oggPagesValid(layout)).toBe(true);
	});

	it("turns away the places of the picture of the walk of the places of the picture of the words of the walk of the picture that stand of no places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of this kind", () => {
		const pcm = Buffer.concat([
			Buffer.from("RIFF", "latin1"),
			Buffer.alloc(4, 0x00),
			Buffer.from("WAVEfmt ", "latin1"),
			Buffer.from([0x10, 0x00, 0x00, 0x00]),
			Buffer.from([0x01, 0x00]),
			Buffer.alloc(0x0e, 0x00),
			Buffer.from("data", "latin1"),
			Buffer.from([0x04, 0x00, 0x00, 0x00]),
			Buffer.alloc(4, 0x00),
		]);
		expect(readOggLayout(pcm)).toBeUndefined();
		expect(readOggLayout(Buffer.alloc(64, 0x00))).toBeUndefined();
		expect(readOggLayout(Buffer.alloc(8, 0x00))).toBeUndefined();
		const short = oggPage(body(16, 0xaa));
		expect(readOggLayout(short.subarray(0, PAGE_HEAD + 2))).toBeUndefined();
		const page = oggPage(body(16, 0xaa));
		const wrong = Buffer.from(page);
		wrong.write("OggX", 0, "latin1");
		expect(readOggLayout(wrong)).toBeUndefined();
	});

	it("stands the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of this kind out as the places of the picture of the walk of them", async () => {
		const page = oggPage(body(16, 0xaa));
		const archive = await oggAudioFormat.open(
			new BufferByteSource(page),
			"sounds/track.ogg",
		);
		const entry = archive.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry.path).toBe("track.ogg");
		expect(entry.size).toBe(BigInt(page.length));
		expect(archive.metadata).toMatchObject({
			audio: "ogg",
			wrapped: false,
			pages: 1,
			crc: "ok",
		});
		expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
			page,
		);
	});

	it("is told by the words of the picture of the walk of the places of the picture", async () => {
		expect(oggAudioFormat.descriptor.id).toBe("ogg-audio");
		const page = oggPage(body(16, 0xaa));
		await expect(
			oggAudioFormat.detect(new BufferByteSource(page)),
		).resolves.toBe(true);
		await expect(
			oggAudioFormat.detect(new BufferByteSource(Buffer.alloc(64, 0x00))),
		).resolves.toBe(false);
		await expect(
			oggAudioFormat.open(
				new BufferByteSource(Buffer.alloc(64, 0x00)),
				"track.ogg",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
