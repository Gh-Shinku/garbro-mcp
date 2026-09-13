import { BufferByteSource } from "@garbro-mcp/core";
import { willPnaFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_START = 0x14;
const RECORD_SIZE = 0x28;

interface Frame {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	content?: Buffer;
}

/** Builds a `PNAP` header, its frame table and the frame payloads. */
function buildPna(frames: readonly Frame[]): Buffer {
	const header = Buffer.alloc(INDEX_START);
	header.write("PNAP", 0, "ascii");
	header.writeInt32LE(frames.length, 0x10);
	const index = Buffer.alloc(frames.length * RECORD_SIZE);
	const payloads: Buffer[] = [];
	for (const [id, frame] of frames.entries()) {
		const record = id * RECORD_SIZE;
		index.writeInt32LE(frame.x ?? 0, record + 0x08);
		index.writeInt32LE(frame.y ?? 0, record + 0x0c);
		index.writeUInt32LE(frame.width ?? 0, record + 0x10);
		index.writeUInt32LE(frame.height ?? 0, record + 0x14);
		const content = frame.content;
		if (content) {
			index.writeUInt32LE(content.length, record + 0x24);
			payloads.push(content);
		}
	}
	return Buffer.concat([header, index, ...payloads]);
}

describe("Pulltop PNA multi-frame archives", () => {
	it("lists frames with their image metadata", async () => {
		const content = Buffer.from("frame pixels");
		const archive = buildPna([{ x: 3, y: 7, width: 32, height: 16, content }]);
		const source = new BufferByteSource(archive);
		expect(await willPnaFormat.detect(source, "PNA.PNA")).toBe(true);
		const handle = await willPnaFormat.open(source, "PNA.PNA");
		expect(handle.entries).toEqual([
			{
				id: "0",
				path: "PNA#000",
				size: BigInt(content.length),
				packedSize: BigInt(content.length),
				compressed: false,
				encrypted: false,
				offset: BigInt(INDEX_START + RECORD_SIZE),
				metadata: {
					type: "image",
					x: 3,
					y: 7,
					width: 32,
					height: 16,
					bpp: 32,
				},
			},
		]);
		expect(handle.metadata).toEqual({ entryCount: 1 });
	});

	it("skips empty frames without advancing the payload cursor or renumbering", async () => {
		const first = Buffer.from("first");
		const second = Buffer.from("second payload");
		const archive = buildPna([
			{ width: 1, height: 1 },
			{ width: 2, height: 2, content: first },
			{ width: 3, height: 3, content: second },
		]);
		await expectArchive({
			format: willPnaFormat,
			archive,
			sourcePath: "PNA.PNA",
			entries: [
				{
					path: "PNA#001",
					size: first.length,
					content: first,
				},
				{
					path: "PNA#002",
					size: second.length,
					content: second,
				},
			],
		});
	});

	it("rejects an unsane frame count", async () => {
		const archive = buildPna([{ x: 1, content: Buffer.from("x") }]);
		archive.writeInt32LE(0x40000, 0x10);
		const source = new BufferByteSource(archive);
		expect(await willPnaFormat.detect(source, "PNA.PNA")).toBe(false);
	});

	it("rejects a frame that falls outside the archive", async () => {
		const archive = buildPna([
			{ width: 1, height: 1, content: Buffer.from("x") },
		]);
		archive.writeUInt32LE(0x1000, INDEX_START + 0x24);
		const source = new BufferByteSource(archive);
		expect(await willPnaFormat.detect(source, "PNA.PNA")).toBe(false);
	});

	it("rejects a truncated frame table", async () => {
		const archive = buildPna([{ content: Buffer.from("x") }]).subarray(
			0,
			INDEX_START + RECORD_SIZE - 1,
		);
		const source = new BufferByteSource(archive);
		expect(await willPnaFormat.detect(source, "PNA.PNA")).toBe(false);
	});
});
