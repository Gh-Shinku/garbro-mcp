import { BufferByteSource } from "@garbro-mcp/core";
import { blackRainbowImpFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

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

describe("BlackRainbow IMP image archives", () => {
	it("lists frames from the offset table", async () => {
		const first = Buffer.alloc(0x30, 0x11);
		const second = Buffer.alloc(0x40, 0x22);
		const archive = buildImp([first, second]);
		const source = new BufferByteSource(archive);
		expect(await blackRainbowImpFormat.detect(source, "IMP.IMP")).toBe(true);
		const handle = await blackRainbowImpFormat.open(source, "IMP.IMP");
		expect(handle.entries).toEqual([
			{
				id: "0",
				path: "IMP#000",
				size: BigInt(first.length),
				packedSize: BigInt(first.length),
				compressed: false,
				encrypted: false,
				offset: BigInt(PAYLOAD_BASE),
				metadata: { type: "image" },
			},
			{
				id: "1",
				path: "IMP#001",
				size: BigInt(second.length),
				packedSize: BigInt(second.length),
				compressed: false,
				encrypted: false,
				offset: BigInt(PAYLOAD_BASE + first.length),
				metadata: { type: "image" },
			},
		]);
		expect(handle.metadata).toEqual({ entryCount: 2, key: 0xce032adb });
	});

	it("extracts frames as stored and keeps the second scheme's key", async () => {
		const payload = Buffer.alloc(0x30, 0x33);
		const archive = buildImp([payload], 0x59e8);
		await expectArchive({
			format: blackRainbowImpFormat,
			archive,
			sourcePath: "FROM.IMP",
			entries: [{ path: "FROM#000", size: payload.length, content: payload }],
			metadata: { key: 0xd36050ec },
		});
	});

	it("skips frames of sixteen bytes or less", async () => {
		const small = Buffer.alloc(0x10, 0x44);
		const big = Buffer.alloc(0x30, 0x55);
		const archive = buildImp([small, big]);
		await expectArchive({
			format: blackRainbowImpFormat,
			archive,
			sourcePath: "IMP.IMP",
			entries: [{ path: "IMP#001", size: big.length, content: big }],
		});
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
