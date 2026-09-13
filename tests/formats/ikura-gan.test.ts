import { BufferByteSource } from "@garbro-mcp/core";
import { ganFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const HEADER_SIZE = 0x10;
const INDEX_OFFSET = 0x2010;
const RECORD_SIZE = 0x10;

interface FrameSpec {
	id: number;
	reference: number;
	payload: Buffer;
}

/** Lays out the header, the fixed area, the frame table and the frames. */
function buildGan(frames: readonly FrameSpec[]): Buffer {
	const header = Buffer.alloc(HEADER_SIZE);
	header.write("GANM0100", 0, "latin1");
	header.writeInt32LE(frames.length, 0xc);
	const tableOffset = INDEX_OFFSET;
	let cursor = tableOffset + frames.length * RECORD_SIZE;
	const table = Buffer.alloc(frames.length * RECORD_SIZE);
	for (const [index, frame] of frames.entries()) {
		const record = index * RECORD_SIZE;
		table.writeInt32LE(frame.id, record);
		table.writeInt32LE(frame.reference, record + 4);
		table.writeUInt32LE(cursor, record + 8);
		table.writeUInt32LE(frame.payload.length, record + 0xc);
		cursor += frame.payload.length;
	}
	const filler = Buffer.alloc(tableOffset - HEADER_SIZE);
	return Buffer.concat([
		header,
		filler,
		table,
		...frames.map((frame) => frame.payload),
	]);
}

async function expectDeclined(file: Buffer): Promise<void> {
	expect(await ganFormat.detect(new BufferByteSource(file), "sample.gan")).toBe(
		false,
	);
}

describe("IKURA GDL animation resource", () => {
	it("lists frames with their declared sizes", async () => {
		const first = Buffer.from("first frame");
		const second = Buffer.from("second frame pixels");
		await expectArchive({
			format: ganFormat,
			sourcePath: "sample.gan",
			archive: buildGan([
				{ id: 1, reference: -1, payload: first },
				{ id: 2, reference: 0, payload: second },
			]),
			entries: [
				{ path: "sample#00", size: first.length, content: first },
				{ path: "sample#01", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("names frames after the file name and pads the index", async () => {
		const frames = Array.from({ length: 12 }, (_, index) => ({
			id: index,
			reference: index === 0 ? -1 : 0,
			payload: Buffer.from([index, 0x41]),
		}));
		const archive = await ganFormat.open(
			new BufferByteSource(buildGan(frames)),
			"inside/anim.GAN",
		);
		expect(archive.entries.map((entry) => entry.path)).toEqual([
			...Array.from({ length: 10 }, (_, index) => `anim#0${index}`),
			"anim#10",
			"anim#11",
		]);
	});

	it("reports the frame id and its reference", async () => {
		const file = buildGan([
			{ id: 7, reference: -1, payload: Buffer.from("frame bytes") },
		]);
		const archive = await ganFormat.open(
			new BufferByteSource(file),
			"sample.gan",
		);
		expect(archive.entries[0]?.metadata).toMatchObject({
			type: "image",
			frameId: 7,
			reference: -1,
		});
	});

	it("rejects a foreign signature", async () => {
		const file = buildGan([
			{ id: 1, reference: -1, payload: Buffer.from("x") },
		]);
		file.write("ZZZZ0100", 0, "latin1");
		await expectDeclined(file);
	});

	it("rejects an archive without a usable count", async () => {
		const file = buildGan([
			{ id: 1, reference: -1, payload: Buffer.from("x") },
		]);
		file.writeInt32LE(0, 0xc);
		await expectDeclined(file);
	});

	it("rejects a frame table that leaves the file", async () => {
		const file = buildGan([
			{ id: 1, reference: -1, payload: Buffer.from("x") },
		]);
		file.writeInt32LE(0x400, 0xc);
		await expectDeclined(file);
	});

	it("rejects a frame that leaves the file", async () => {
		const file = buildGan([
			{ id: 1, reference: -1, payload: Buffer.from("x") },
		]);
		file.writeUInt32LE(file.length, INDEX_OFFSET + 0xc);
		await expectDeclined(file);
	});

	it("rejects an archive that is too small for its table", async () => {
		await expectDeclined(Buffer.from("GANM0100", "latin1"));
	});
});
