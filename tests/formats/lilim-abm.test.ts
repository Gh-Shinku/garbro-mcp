import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { abmFormat } from "../../packages/formats/src/lilim/abm.js";

const HEADER_SIZE = 0x46;

interface AbmOptions {
	mode?: number;
	count?: number;
	width?: number;
	height?: number;
	marker?: string;
	firstOffset?: number;
}

/** Builds a multi-frame bitmap: the header, the offset chain and then the frame payloads. */
function buildAbm(payloads: Buffer[], options: AbmOptions = {}): Buffer {
	const count = options.count ?? payloads.length;
	const chainWords = Math.max(count - 1, 0);
	const first = options.firstOffset ?? HEADER_SIZE + chainWords * 4;
	const offsets: number[] = [];
	let position = first;
	for (const payload of payloads) {
		offsets.push(position);
		position += payload.length;
	}
	const file = Buffer.alloc(position);
	file.write(options.marker ?? "BM", 0, "latin1");
	file.writeUInt32LE(options.width ?? 4, 0x12);
	file.writeUInt32LE(options.height ?? 3, 0x16);
	file.writeInt8(options.mode ?? 1, 0x1c);
	file.writeInt16LE(count, 0x3a);
	file.writeUInt32LE(offsets[0] ?? first, 0x42);
	for (let index = 0; index < chainWords; index += 1) {
		file.writeUInt32LE(offsets[index + 1] ?? 0, HEADER_SIZE + index * 4);
	}
	payloads.forEach((payload, index) => {
		payload.copy(file, offsets[index] ?? 0);
	});
	return file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("lilim abm", () => {
	it("lists the frames of a multi-frame bitmap", async () => {
		const frames = [
			Buffer.from("first frame pixels"),
			Buffer.from("second frame, longer payload"),
			Buffer.from("third"),
		];
		const file = buildAbm(frames);
		const source = sourceOf(file);
		expect(await abmFormat.detect(source, "game.abm")).toBe(true);
		const archive = await abmFormat.open(source, "game.abm");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"game#0000",
				"game#0001",
				"game#0002",
			]);
			expect(archive.entries.map((entry) => Number(entry.size))).toEqual(
				frames.map((frame) => frame.length),
			);
			expect(archive.metadata).toMatchObject({
				entryCount: 3,
				width: 4,
				height: 3,
				bpp: 24,
				mode: 1,
				baseOffset: HEADER_SIZE + 8,
			});
			// The unpacked size is the bitmap header plus width * height * 3.
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				unpackedSize: 0x12 + 4 * 3 * 3,
				frameIndex: 0,
			});
			for (const [index, entry] of archive.entries.entries()) {
				expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
					frames[index],
				);
			}
		} finally {
			await archive.close();
		}
	});

	it("names the frames after the archive file", async () => {
		const file = buildAbm([Buffer.from("only frame")]);
		const source = sourceOf(file);
		const archive = await abmFormat.open(source, "/some/dir/SAMPLE.ABM");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"SAMPLE#0000",
			]);
		} finally {
			await archive.close();
		}
	});

	it("reports a four byte pixel for the second mode", async () => {
		const file = buildAbm([Buffer.from("rgba frame")], {
			mode: 2,
			width: 2,
			height: 2,
		});
		const source = sourceOf(file);
		const archive = await abmFormat.open(source, "color.abm");
		try {
			expect(archive.metadata).toMatchObject({ bpp: 32, mode: 2 });
			expect(archive.entries[0]?.metadata).toMatchObject({
				unpackedSize: 0x12 + 2 * 2 * 4,
			});
		} finally {
			await archive.close();
		}
	});

	it("declines a file that is not a bitmap", async () => {
		const file = buildAbm([Buffer.from("frame")], { marker: "XY" });
		expect(await abmFormat.detect(sourceOf(file), "game.abm")).toBe(false);
	});

	it("declines a mode outside the supported range", async () => {
		const file = buildAbm([Buffer.from("frame")], { mode: 3 });
		expect(await abmFormat.detect(sourceOf(file), "game.abm")).toBe(false);
	});

	it("declines an empty frame list", async () => {
		const file = buildAbm([Buffer.from("frame")], { count: 0 });
		expect(await abmFormat.detect(sourceOf(file), "game.abm")).toBe(false);
	});

	it("declines a frame chain that does not advance", async () => {
		const frames = [Buffer.from("first"), Buffer.from("second")];
		const file = buildAbm(frames);
		// Point the second frame at the first one.
		file.writeUInt32LE(HEADER_SIZE + 4, HEADER_SIZE);
		expect(await abmFormat.detect(sourceOf(file), "game.abm")).toBe(false);
	});

	it("declines a first frame behind the end of the file", async () => {
		const file = buildAbm([Buffer.from("frame")]);
		// Keep the file small but point the stored first offset far past its end.
		file.writeUInt32LE(0x10000, 0x42);
		expect(await abmFormat.detect(sourceOf(file), "game.abm")).toBe(false);
	});
});
