import { BufferByteSource } from "@garbro-mcp/core";
import { zyxBdfFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const RECORD_SIZE = 0x1c;
const INDEX_START = 4;

interface Frame {
	payload: Buffer;
	width?: number;
	height?: number;
	incremental?: boolean;
}

/** Lays out a Zyx multi-frame package with a fixed size record per frame. */
function buildBdf(frames: readonly Frame[]): Buffer {
	const indexSize = frames.length * RECORD_SIZE;
	const records = Buffer.alloc(indexSize);
	const payloads: Buffer[] = [];
	let offset = 0;
	frames.forEach((frame, id) => {
		const base = id * RECORD_SIZE;
		records.writeUInt32LE(offset, base);
		records.writeUInt32LE(frame.payload.length, base + 4);
		records.writeInt32LE(frame.incremental ? 1 : 0, base + 8);
		records.writeInt32LE(frame.width ?? 8, base + 0x14);
		records.writeInt32LE(frame.height ?? 6, base + 0x18);
		payloads.push(frame.payload);
		offset += frame.payload.length;
	});
	const header = Buffer.alloc(INDEX_START);
	header.writeInt32LE(frames.length, 0);
	return Buffer.concat([header, records, ...payloads]);
}

describe("Zyx multi-frame image package", () => {
	it("reads all frames", async () => {
		const first = Buffer.from([0, 1, 2, 3, 4, 5]);
		const second = Buffer.from([9, 8, 7, 6, 5]);
		await expectArchive({
			format: zyxBdfFormat,
			sourcePath: "scene.bdf",
			archive: buildBdf([
				{ payload: first },
				{ payload: second, incremental: true },
			]),
			entries: [
				{ path: "scene#00", size: first.length, content: first },
				{ path: "scene#01", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("keeps frame numbers across skipped records", async () => {
		const third = Buffer.from([1, 2, 3, 4]);
		const file = buildBdf([
			{ payload: Buffer.alloc(0) },
			{ payload: Buffer.alloc(0) },
			{ payload: third },
		]);
		const archive = await zyxBdfFormat.open(
			new BufferByteSource(file),
			"scene.bdf",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["scene#02"]);
		} finally {
			await archive.close();
		}
	});

	it("exposes frame geometry", async () => {
		const payload = Buffer.from([1, 2, 3, 4]);
		const file = buildBdf([{ payload, width: 0x20, height: 0x10 }]);
		const archive = await zyxBdfFormat.open(
			new BufferByteSource(file),
			"scene.bdf",
		);
		try {
			expect(archive.entries[0]).toMatchObject({
				path: "scene#00",
				size: 4n,
				metadata: {
					type: "image",
					width: 0x20,
					height: 0x10,
					incremental: false,
				},
			});
		} finally {
			await archive.close();
		}
	});

	it("uses the file name as the frame prefix", async () => {
		const payload = Buffer.from([1, 2, 3, 4]);
		const file = buildBdf([{ payload }]);
		const archive = await zyxBdfFormat.open(
			new BufferByteSource(file),
			"nested/dir/Anim.BDF",
		);
		try {
			expect(archive.entries[0]?.path).toBe("Anim#00");
		} finally {
			await archive.close();
		}
	});

	it("rejects an empty frame list", async () => {
		const file = buildBdf([]);
		expect(await zyxBdfFormat.detect(new BufferByteSource(file), "a.bdf")).toBe(
			false,
		);
	});

	it("rejects more than a hundred frames", async () => {
		const file = buildBdf([{ payload: Buffer.from([1, 2, 3, 4]) }]);
		file.writeInt32LE(101, 0);
		expect(await zyxBdfFormat.detect(new BufferByteSource(file), "a.bdf")).toBe(
			false,
		);
	});

	it("rejects a non zero first offset", async () => {
		const file = buildBdf([{ payload: Buffer.from([1, 2, 3, 4]) }]);
		file.writeInt32LE(8, INDEX_START);
		expect(await zyxBdfFormat.detect(new BufferByteSource(file), "a.bdf")).toBe(
			false,
		);
	});

	it("rejects a frame without geometry", async () => {
		const file = buildBdf([{ payload: Buffer.from([1, 2, 3, 4]), width: 0 }]);
		expect(await zyxBdfFormat.detect(new BufferByteSource(file), "a.bdf")).toBe(
			false,
		);
	});

	it("rejects a frame that is too small", async () => {
		const file = buildBdf([{ payload: Buffer.from([1, 2]) }]);
		expect(await zyxBdfFormat.detect(new BufferByteSource(file), "a.bdf")).toBe(
			false,
		);
	});

	it("rejects a frame outside the file", async () => {
		const file = buildBdf([{ payload: Buffer.from([1, 2, 3, 4]) }]);
		file.writeUInt32LE(0x1000, INDEX_START + 4);
		expect(await zyxBdfFormat.detect(new BufferByteSource(file), "a.bdf")).toBe(
			false,
		);
	});

	it("rejects an index that does not fit", async () => {
		const file = buildBdf([{ payload: Buffer.from([1, 2, 3, 4]) }]);
		// Claim a hundred records in a file that only holds one.
		file.writeInt32LE(100, 0);
		expect(await zyxBdfFormat.detect(new BufferByteSource(file), "a.bdf")).toBe(
			false,
		);
	});

	it("rejects a truncated header", async () => {
		const file = buildBdf([{ payload: Buffer.from([1, 2, 3, 4]) }]);
		expect(
			await zyxBdfFormat.detect(
				new BufferByteSource(file.subarray(0, 8)),
				"a.bdf",
			),
		).toBe(false);
	});
});
