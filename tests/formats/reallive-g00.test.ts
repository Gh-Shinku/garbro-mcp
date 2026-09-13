import { BufferByteSource } from "@garbro-mcp/core";
import { realliveG00Format } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const FILE_TYPE = 2;
const FRAME_HEADER_SIZE = 0x18;
const FRAME_TABLE_OFFSET = 9;

/** Encodes a table with control bytes whose bits mark literal pixels. */
function encodeLiterals(data: Buffer): Buffer {
	const parts: number[] = [];
	for (let start = 0; start < data.length; start += 8) {
		const group = [...data.subarray(start, start + 8)];
		let control = 0;
		for (let bit = 0; bit < group.length; bit += 1) control |= 1 << bit;
		parts.push(control, ...group);
	}
	return Buffer.from(parts);
}

/** Wraps an encoded table in the header the archive stores it with. */
function packTable(stream: Buffer, unpackedSize: number): Buffer {
	const header = Buffer.alloc(8);
	header.writeInt32LE(stream.length + 8, 0);
	header.writeInt32LE(unpackedSize, 4);
	return Buffer.concat([header, stream]);
}

/** Builds a file header that announces the given number of frames. */
function buildHeader(frameCount: number): Buffer {
	const header = Buffer.alloc(
		FRAME_TABLE_OFFSET + frameCount * FRAME_HEADER_SIZE,
	);
	header.writeUInt8(FILE_TYPE, 0);
	header.writeUInt16LE(640, 1);
	header.writeUInt16LE(480, 3);
	header.writeInt16LE(frameCount, 5);
	return header;
}

/** Builds a file whose table holds one entry per frame, in the order they are given. */
function buildFrameFile(frames: readonly Buffer[]): Buffer {
	const table = Buffer.alloc(4 + frames.length * 8);
	table.writeInt32LE(frames.length, 0);
	let cursor = table.length;
	for (const [index, frame] of frames.entries()) {
		table.writeUInt32LE(cursor, 4 + index * 8);
		table.writeUInt32LE(frame.length, 8 + index * 8);
		cursor += frame.length;
	}
	const unpacked = Buffer.concat([table, ...frames]);
	return Buffer.concat([
		buildHeader(frames.length),
		packTable(encodeLiterals(unpacked), unpacked.length),
	]);
}

/** Builds a file around a table that the caller encoded itself. */
function buildEncodedFile(
	stream: Buffer,
	unpacked: Buffer,
	frameCount: number,
): Buffer {
	return Buffer.concat([
		buildHeader(frameCount),
		packTable(stream, unpacked.length),
	]);
}

async function expectDeclined(
	file: Buffer,
	sourcePath = "sample.g00",
): Promise<void> {
	const source = new BufferByteSource(file);
	expect(await realliveG00Format.detect(source, sourcePath)).toBe(false);
}

describe("RealLive engine multi-frame image", () => {
	it("lists the frames of a table and keeps their indices", async () => {
		const first = Buffer.from("first");
		const second = Buffer.from("second!");
		await expectArchive({
			format: realliveG00Format,
			sourcePath: "sample.g00",
			archive: buildFrameFile([first, Buffer.alloc(0), second]),
			entries: [
				{ path: "sample#000", size: first.length, content: first },
				{ path: "sample#002", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("unpacks a table that copies from earlier output", async () => {
		// Two frames whose content repeats a byte, so the table needs a copy with distance one and count
		// three. Frame one holds the single byte, frame two the repetition.
		const table = Buffer.alloc(24);
		table.writeInt32LE(2, 0);
		table.writeUInt32LE(21, 4);
		table.writeUInt32LE(1, 8);
		table.writeUInt32LE(21, 12);
		table.writeUInt32LE(3, 16);
		table.write("a", 20, "latin1");
		const stream = Buffer.concat([
			Buffer.from([0xff]),
			table.subarray(0, 8),
			Buffer.from([0xff]),
			table.subarray(8, 16),
			Buffer.from([0x1f]),
			table.subarray(16, 21),
			Buffer.from([0x11, 0x00]),
		]);
		await expectArchive({
			format: realliveG00Format,
			sourcePath: "sample.g00",
			archive: buildEncodedFile(stream, table, 2),
			entries: [
				{ path: "sample#000", size: 1, content: Buffer.from("a") },
				{ path: "sample#001", size: 3, content: Buffer.from("aaa") },
			],
		});
	});

	it("rejects a file without the format type byte", async () => {
		const file = buildFrameFile([Buffer.from("frame"), Buffer.from("frame")]);
		file.writeUInt8(3, 0);
		await expectDeclined(file);
	});

	it("rejects a file whose dimensions are out of range", async () => {
		const file = buildFrameFile([Buffer.from("frame"), Buffer.from("frame")]);
		file.writeUInt16LE(0, 1);
		await expectDeclined(file);
	});

	it("rejects a file with a single frame", async () => {
		await expectDeclined(buildFrameFile([Buffer.from("frame")]));
	});

	it("rejects a table whose frame count disagrees with the header", async () => {
		const table = Buffer.alloc(4 + 8);
		table.writeInt32LE(7, 0);
		await expectDeclined(buildEncodedFile(encodeLiterals(table), table, 2));
	});

	it("rejects a file that is not named as a frame table", async () => {
		await expectDeclined(
			buildFrameFile([Buffer.from("frame"), Buffer.from("frame")]),
			"sample.bin",
		);
	});
});
