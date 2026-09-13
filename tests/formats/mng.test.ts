import { BufferByteSource } from "@garbro-mcp/core";
import { mngFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const MNG_SIGNATURE = Buffer.from([0x8a, 0x4d, 0x4e, 0x47]);
const MNG_DATA_MARKER = Buffer.from([0x0d, 0x0a, 0x1a, 0x0a]);
const MHDR_SIZE = 28;

/** Builds one MNG chunk; the CRC bytes are left zero, the readers ignore them. */
function chunk(type: string, data: Buffer): Buffer {
	const header = Buffer.alloc(8);
	header.writeUInt32BE(data.length, 0);
	header.write(type, 4, "latin1");
	return Buffer.concat([header, data, Buffer.alloc(4)]);
}

/** Builds an MNG stream with a header chunk, the given chunks and a closing MEND. */
function buildMng(chunks: readonly Buffer[], mhdr?: Buffer): Buffer {
	const header = mhdr ?? chunk("MHDR", Buffer.alloc(MHDR_SIZE));
	return Buffer.concat([
		MNG_SIGNATURE,
		MNG_DATA_MARKER,
		header,
		...chunks,
		chunk("MEND", Buffer.alloc(0)),
	]);
}

/** A minimal PNG stream made of an IHDR, an IDAT and an IEND chunk. */
function pngStream(pixels: Buffer): Buffer {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(1, 0);
	ihdr.writeUInt32BE(1, 4);
	return Buffer.concat([
		chunk("IHDR", ihdr),
		chunk("IDAT", pixels),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

describe("MNG multi-frame image", () => {
	it("reads a single frame", async () => {
		const png = pngStream(Buffer.from("pixels"));
		await expectArchive({
			format: mngFormat,
			sourcePath: "movie.mng",
			archive: buildMng([png]),
			entries: [{ path: "movie#00.png", size: png.length, content: png }],
			metadata: { entryCount: 1 },
		});
	});

	it("reads several frames", async () => {
		const first = pngStream(Buffer.from("one"));
		const second = pngStream(Buffer.from("two"));
		await expectArchive({
			format: mngFormat,
			sourcePath: "anim.mng",
			archive: buildMng([first, second]),
			entries: [
				{ path: "anim#00.png", size: first.length, content: first },
				{ path: "anim#01.png", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("skips chunks before the frames", async () => {
		const png = pngStream(Buffer.from("pixels"));
		await expectArchive({
			format: mngFormat,
			sourcePath: "movie.mng",
			archive: buildMng([chunk("TERM", Buffer.from([1, 2, 3])), png]),
			entries: [{ path: "movie#00.png", size: png.length, content: png }],
		});
	});

	it("registers the mng signature", () => {
		const signatures = mngFormat.detection?.signatures ?? [];
		expect(signatures[0]?.bytes).toEqual(MNG_SIGNATURE);
	});

	it("rejects a wrong header chunk", async () => {
		const file = buildMng(
			[pngStream(Buffer.from("x"))],
			chunk("MHDR", Buffer.alloc(MHDR_SIZE)).fill(0x54, 4, 8),
		);
		expect(await mngFormat.detect(new BufferByteSource(file))).toBe(false);
	});

	it("rejects a short header chunk", async () => {
		const file = buildMng(
			[pngStream(Buffer.from("x"))],
			chunk("MHDR", Buffer.alloc(4)),
		);
		expect(await mngFormat.detect(new BufferByteSource(file))).toBe(false);
	});

	it("rejects a stream without a frame", async () => {
		const file = buildMng([]);
		expect(await mngFormat.detect(new BufferByteSource(file))).toBe(false);
	});

	it("rejects a frame without a header chunk", async () => {
		const file = buildMng([chunk("IEND", Buffer.alloc(0))]);
		expect(await mngFormat.detect(new BufferByteSource(file))).toBe(false);
	});

	it("rejects a frame that runs past the end of file", async () => {
		const file = buildMng([
			chunk("IHDR", Buffer.alloc(13)),
			chunk("IEND", Buffer.alloc(0)),
		]);
		// Claim an ending chunk that reaches beyond the file.
		file.writeUInt32BE(0x1000, file.indexOf("IEND", 0, "latin1") - 4);
		expect(await mngFormat.detect(new BufferByteSource(file))).toBe(false);
	});

	it("rejects missing magic bytes", async () => {
		const file = buildMng([pngStream(Buffer.from("x"))]);
		file.writeUInt32BE(0, 4);
		expect(await mngFormat.detect(new BufferByteSource(file))).toBe(false);
	});
});
