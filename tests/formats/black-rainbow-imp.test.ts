import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { blackRainbowImpFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";

const PAYLOAD_BASE = 0x404;
const ENTRY_COUNT = 0xff;
const TABLE_SIZE = (ENTRY_COUNT + 1) * 4;

/**
 * Builds an IMP archive. The table at 0x04 holds the first frame offset followed by every frame end;
 * frames are placed back to back behind the header.
 */
function buildImp(payloads: readonly Buffer[], signature = 0x3d66): Buffer {
	const header = Buffer.alloc(PAYLOAD_BASE, 0);
	header.writeUInt32LE(signature, 0);
	const table = header.subarray(4, 4 + TABLE_SIZE);
	let offset = 0;
	table.writeUInt32LE(offset, 0);
	for (const [id, payload] of payloads.entries()) {
		offset += payload.length;
		table.writeUInt32LE(offset, (id + 1) * 4);
	}
	// The remaining offsets repeat the last one, so no further frames are reported.
	for (let id = payloads.length + 1; id <= ENTRY_COUNT; id += 1) {
		table.writeUInt32LE(offset, id * 4);
	}
	return Buffer.concat([header, ...payloads]);
}

/** The key of a scheme, of the places of the file of it, as the engine reads them. */
function keyBytes(signature: number): Buffer {
	const key = Buffer.alloc(4, 0x00);
	key.writeUInt32LE(0x59e8 === signature ? 0xd36050ec : 0xce032adb, 0);
	return key;
}

/**
 * A frame of the engine: the head of it, and the run of the places of the picture behind it. The walk of the
 * engine reads a control word of eight decisions, of the places of the file they stand for behind it, and
 * every place of the file of the run stands of the key of the archive.
 */
function impFrame(
	width: number,
	height: number,
	pixels: readonly number[],
	signature = 0x3d66,
): Buffer {
	const run: number[] = [];
	for (let at = 0; at < pixels.length; at += 8) {
		run.push(0xff);
		for (let index = at; index < at + 8; index += 1) {
			run.push(pixels[index] ?? 0);
		}
	}
	const head = Buffer.alloc(0x10, 0x00);
	head.writeUInt32LE(width, 0);
	head.writeUInt32LE(height, 4);
	head.writeUInt32LE(run.length, 8);
	head.writeUInt32LE(1, 12);
	const key = keyBytes(signature);
	for (let at = 0; at < run.length; at += 1) {
		run[at] = (run[at] ?? 0) ^ (key[at % 4] ?? 0);
	}
	return Buffer.concat([head, Buffer.from(run)]);
}

describe("BlackRainbow IMP image archives", () => {
	it("lists frames from the offset table", async () => {
		const first = Buffer.alloc(0x30, 0x11);
		const second = Buffer.alloc(0x40, 0x22);
		const archive = buildImp([first, second]);
		const source = new BufferByteSource(archive);
		expect(await blackRainbowImpFormat.detect(source, "IMP.IMP")).toBe(true);
		const handle = await blackRainbowImpFormat.open(source, "IMP.IMP");
		expect(
			handle.entries.map((entry) => ({
				path: entry.path,
				size: entry.size,
				packedSize: entry.packedSize,
			})),
		).toEqual([
			{
				path: "IMP#000",
				size: BigInt(first.length),
				packedSize: BigInt(first.length),
			},
			{
				path: "IMP#001",
				size: BigInt(second.length),
				packedSize: BigInt(second.length),
			},
		]);
		expect(handle.metadata).toEqual({ entryCount: 2, key: 0xce032adb });
	});

	it("reads the picture of a frame, of the key of the archive", async () => {
		// Four places of a colour to a pixel, of the counts of the places of the file themselves, so the
		// places of the picture of the frame stand of their own.
		const pixels = Array.from(
			{ length: 2 * 2 * 4 },
			(_, at) => (at * 7) & 0xff,
		);
		const frame = impFrame(2, 2, pixels, 0x59e8);
		const archive = buildImp([frame], 0x59e8);
		const handle = await blackRainbowImpFormat.open(
			new BufferByteSource(archive),
			"FROM.IMP",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const image = readBmpImage(
			await consumeBuffer(await handle.openEntry(entry.id)),
		);
		expect(image).toMatchObject({ width: 2, height: 2, bitsPerPixel: 32 });
		expect([...(image?.pixels ?? [])]).toEqual(pixels);
		expect(handle.metadata).toEqual({ entryCount: 1, key: 0xd36050ec });
	});

	it("turns away a frame that stands of no count of its own", async () => {
		const frame = Buffer.alloc(0x40, 0x33);
		const archive = buildImp([frame]);
		const handle = await blackRainbowImpFormat.open(
			new BufferByteSource(archive),
			"IMP.IMP",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		await expect(handle.openEntry(entry.id)).rejects.toThrow(/IMP frame/);
	});

	it("skips frames of sixteen bytes or less", async () => {
		const small = Buffer.alloc(0x10, 0x44);
		const big = impFrame(1, 1, [0x01, 0x02, 0x03, 0x04]);
		const archive = buildImp([small, big]);
		const handle = await blackRainbowImpFormat.open(
			new BufferByteSource(archive),
			"IMP.IMP",
		);
		expect(handle.entries.map((entry) => entry.path)).toEqual(["IMP#001"]);
	});

	it("rejects an archive without any frames", async () => {
		const header = Buffer.alloc(PAYLOAD_BASE, 0);
		header.writeUInt32LE(0x3d66, 0);
		const source = new BufferByteSource(header);
		expect(await blackRainbowImpFormat.detect(source, "IMP.IMP")).toBe(false);
	});

	it("rejects an unknown scheme", async () => {
		const archive = buildImp([Buffer.alloc(0x30)], 0x1234);
		const source = new BufferByteSource(archive);
		expect(await blackRainbowImpFormat.detect(source, "IMP.IMP")).toBe(false);
	});

	it("rejects a truncated header", async () => {
		const archive = buildImp([Buffer.alloc(0x30)]).subarray(0, 0x200);
		const source = new BufferByteSource(archive);
		expect(await blackRainbowImpFormat.detect(source, "IMP.IMP")).toBe(false);
	});
});
