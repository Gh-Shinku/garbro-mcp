import { BufferByteSource } from "@garbro-mcp/core";
import { decompressMgrFrame, propellerMgrFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const FRAME_HEADER_SIZE = 8;
/** The `BM` marker is probed relative to the start of the first frame record. */
const BMP_MARKER_OFFSET = 9;
const MIN_UNPACKED_SIZE = 0x36;

/** Encodes a payload as literal runs of at most 0x20 bytes. */
function encodeLiterals(content: Buffer): Buffer {
	const parts: number[] = [];
	for (let offset = 0; offset < content.length; offset += 0x20) {
		const chunk = content.subarray(offset, offset + 0x20);
		parts.push(chunk.length - 1, ...chunk);
	}
	return Buffer.from(parts);
}

/** A payload that starts with the `BM` marker the reference probes for. */
function bitmapPayload(fill: number, length = MIN_UNPACKED_SIZE): Buffer {
	const content = Buffer.alloc(length, fill);
	content.write("BM", 0, "ascii");
	return content;
}

function buildMgr(payloads: readonly Buffer[]): Buffer {
	const frames = payloads.map((payload) => encodeLiterals(payload));
	const count = frames.length;
	const tableLength = count > 1 ? count * 4 : 0;
	const firstFrame = 2 + tableLength;
	const total = frames.reduce((sum, frame) => sum + frame.length, 0);
	const archive = Buffer.alloc(firstFrame + count * FRAME_HEADER_SIZE + total);
	archive.writeUInt16LE(count, 0);
	let frameOffset = firstFrame;
	for (const [id, payload] of payloads.entries()) {
		const frame = frames[id] ?? Buffer.alloc(0);
		if (count > 1) archive.writeUInt32LE(frameOffset, 2 + id * 4);
		archive.writeUInt32LE(payload.length, frameOffset);
		archive.writeUInt32LE(frame.length, frameOffset + 4);
		frame.copy(archive, frameOffset + FRAME_HEADER_SIZE);
		frameOffset += FRAME_HEADER_SIZE + frame.length;
	}
	return archive;
}

describe("Propeller MGR multi-frame image", () => {
	it("decodes literal runs and back references", () => {
		// One literal `A` followed by a distance-one reference with a length of five.
		const stream = Buffer.from([0x00, 0x41, 0x60, 0x00]);
		expect(decompressMgrFrame(stream, 6).toString("latin1")).toBe("AAAAAA");
	});

	it("reads a multi-frame archive", async () => {
		const first = bitmapPayload(0x11);
		const second = bitmapPayload(0x22);
		const archive = buildMgr([first, second]);
		await expectArchive({
			format: propellerMgrFormat,
			archive,
			sourcePath: "/games/sample.mgr",
			metadata: { entryCount: 2 },
			entries: [
				{ path: "sample#0000.bmp", size: first.length, content: first },
				{ path: "sample#0001.bmp", size: second.length, content: second },
			],
		});
	});

	it("reads a single-frame archive without an offset table", async () => {
		const payload = bitmapPayload(0x33);
		const archive = buildMgr([payload]);
		await expectArchive({
			format: propellerMgrFormat,
			archive,
			sourcePath: "/games/single.mgr",
			entries: [{ path: "single.bmp", size: payload.length, content: payload }],
		});
	});

	it("requires the mgr extension", async () => {
		const archive = buildMgr([bitmapPayload(0x44)]);
		const source = new BufferByteSource(archive);
		expect(await propellerMgrFormat.detect(source, "/games/sample.bin")).toBe(
			false,
		);
		expect(await propellerMgrFormat.detect(source, "/games/sample.mgr")).toBe(
			true,
		);
	});

	it("rejects a first offset that does not follow the table", async () => {
		const archive = buildMgr([bitmapPayload(0x55), bitmapPayload(0x66)]);
		archive.writeUInt32LE(0x1000, 2);
		const source = new BufferByteSource(archive);
		expect(await propellerMgrFormat.detect(source, "/games/sample.mgr")).toBe(
			false,
		);
	});

	it("rejects a frame without the bitmap marker", async () => {
		const payload = bitmapPayload(0x77);
		const archive = buildMgr([payload]);
		// The marker is probed nine bytes into the record, i.e. two bytes into the stored stream.
		archive[2 + FRAME_HEADER_SIZE + 1] = 0x58;
		const source = new BufferByteSource(archive);
		expect(await propellerMgrFormat.detect(source, "/games/sample.mgr")).toBe(
			false,
		);
	});

	it("rejects a frame smaller than an empty bitmap", async () => {
		const payload = bitmapPayload(0x88);
		const archive = buildMgr([payload]);
		archive.writeUInt32LE(MIN_UNPACKED_SIZE - 1, 2);
		const source = new BufferByteSource(archive);
		expect(await propellerMgrFormat.detect(source, "/games/sample.mgr")).toBe(
			false,
		);
	});
});
