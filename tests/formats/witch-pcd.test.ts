import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { pcdImageFormat } from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_OFFSET = 0xe;
const RECTANGLE_SIZE = 0x18;
const PAYLOAD_HEADER_SIZE = 0x20;

interface PayloadSpec {
	/** The payload header: a format id and, for the compressed formats, the unpacked size. */
	formatId: number;
	unpackedSize?: number;
	body: Buffer;
	/** Padding behind the body, kept inside the frame region. */
	padding?: number;
}

interface FrameSpec extends PayloadSpec {
	name: string;
	frameName?: string;
	rectangle?: { left: number; top: number; right: number; bottom: number };
}

/** Both names are stored with every byte complemented. */
function encodeField(value: string): Buffer {
	const bytes = Buffer.from(value, "latin1");
	for (let index = 0; index < bytes.length; index += 1)
		bytes[index] = (bytes[index] ?? 0) ^ 0xff;
	const field = Buffer.alloc(4 + bytes.length);
	field.writeInt32LE(bytes.length, 0);
	bytes.copy(field, 4);
	return field;
}

function buildPayload(spec: PayloadSpec): Buffer {
	const header = Buffer.alloc(PAYLOAD_HEADER_SIZE);
	header.writeUInt32LE(spec.formatId, 0);
	header.writeUInt32LE(spec.unpackedSize ?? spec.body.length, 4);
	const body =
		spec.formatId === 1 ? deflateSync(spec.body) : Buffer.from(spec.body);
	return Buffer.concat([header, body, Buffer.alloc(spec.padding ?? 0)]);
}

/** Lays out the header, the records and the payload regions. */
function buildPcd(frames: readonly FrameSpec[]): Buffer {
	const payloads = frames.map(buildPayload);
	const fields = frames.map((frame) => [
		encodeField(frame.name),
		encodeField(frame.frameName ?? "NO NAME"),
	]);
	const recordLength = fields.reduce(
		(sum, entry) =>
			sum +
			RECTANGLE_SIZE +
			(entry[0]?.length ?? 0) +
			(entry[1]?.length ?? 0) +
			4,
		0,
	);
	const records: Buffer[] = [];
	let payloadCursor = INDEX_OFFSET + recordLength;
	for (const [index, frame] of frames.entries()) {
		const rectangle = frame.rectangle ?? {
			left: 1,
			top: 2,
			right: 11,
			bottom: 22,
		};
		const record = Buffer.alloc(RECTANGLE_SIZE);
		record.writeInt32LE(rectangle.left, 8);
		record.writeInt32LE(rectangle.top, 0xc);
		record.writeInt32LE(rectangle.right, 0x10);
		record.writeInt32LE(rectangle.bottom, 0x14);
		const offset = Buffer.alloc(4);
		offset.writeUInt32LE(payloadCursor, 0);
		records.push(Buffer.concat([record, ...(fields[index] ?? []), offset]));
		payloadCursor += payloads[index]?.length ?? 0;
	}
	const header = Buffer.alloc(INDEX_OFFSET);
	header.write("IMAGEDATE ", 0, "latin1");
	header.writeInt32LE(frames.length, 0xa);
	return Buffer.concat([header, ...records, ...payloads]);
}

async function expectDeclined(file: Buffer): Promise<void> {
	expect(
		await pcdImageFormat.detect(new BufferByteSource(file), "imagedate.bin"),
	).toBe(false);
}

describe("Witch IMAGEDATE image archive", () => {
	it("lists frames with adjacent sizes", async () => {
		const first = { formatId: 0, body: Buffer.from("first body") };
		const second = { formatId: 0, body: Buffer.from("second body!") };
		const firstRegion = buildPayload(first);
		const secondRegion = buildPayload(second);
		await expectArchive({
			format: pcdImageFormat,
			sourcePath: "imagedate.bin",
			archive: buildPcd([
				{ name: "face/001", frameName: "base", ...first },
				{ name: "face/002", ...second },
			]),
			entries: [
				{
					path: "face/001/base",
					size: firstRegion.length - PAYLOAD_HEADER_SIZE,
					content: first.body,
				},
				{
					path: "face/002",
					size: secondRegion.length - PAYLOAD_HEADER_SIZE,
					content: second.body,
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("inflates a zlib frame", async () => {
		const body = Buffer.from("compressed frame contents");
		await expectArchive({
			format: pcdImageFormat,
			sourcePath: "imagedate.bin",
			archive: buildPcd([
				{ name: "face/010", formatId: 1, body, unpackedSize: body.length },
			]),
			entries: [{ path: "face/010", size: body.length, content: body }],
		});
	});

	it("keeps a frame with an unknown format as it is", async () => {
		const body = Buffer.from("raw frame body");
		await expectArchive({
			format: pcdImageFormat,
			sourcePath: "imagedate.bin",
			archive: buildPcd([{ name: "face/020", formatId: 7, body }]),
			entries: [
				{
					path: "face/020",
					size: body.length + PAYLOAD_HEADER_SIZE,
					content: Buffer.concat([bufferHeader(7, body.length), body]),
				},
			],
		});
	});

	it("replaces a slash inside a frame name", async () => {
		const body = Buffer.from("frame body");
		await expectArchive({
			format: pcdImageFormat,
			sourcePath: "imagedate.bin",
			archive: buildPcd([
				{ name: "face/030", frameName: "a/b", formatId: 0, body },
			]),
			entries: [
				{ path: "face/030/a\uff0fb", size: body.length, content: body },
			],
		});
	});

	it("reports the frame rectangle", async () => {
		const body = Buffer.from("frame body");
		const file = buildPcd([
			{
				name: "face/040",
				formatId: 0,
				body,
				rectangle: { left: 5, top: 6, right: 25, bottom: 46 },
			},
		]);
		const archive = await pcdImageFormat.open(
			new BufferByteSource(file),
			"imagedate.bin",
		);
		expect(archive.entries[0]?.metadata).toMatchObject({
			width: 20,
			height: 40,
			offsetX: 5,
			offsetY: 6,
		});
	});

	it("rejects a bzip2 frame at extraction", async () => {
		const file = buildPcd([
			{ name: "face/050", formatId: 2, body: Buffer.from("bzip body") },
		]);
		const archive = await pcdImageFormat.open(
			new BufferByteSource(file),
			"imagedate.bin",
		);
		const entry = archive.entries[0];
		if (!entry) throw new Error("Missing entry");
		await expect(archive.openEntry(entry.id)).rejects.toBeInstanceOf(
			GarbroError,
		);
	});

	it("rejects a foreign signature", async () => {
		const file = buildPcd([
			{ name: "face/060", formatId: 0, body: Buffer.from("x") },
		]);
		file.write("ZZZZZZZZZZ ", 0, "latin1");
		await expectDeclined(file);
	});

	it("rejects an archive without a usable count", async () => {
		const file = buildPcd([
			{ name: "face/070", formatId: 0, body: Buffer.from("x") },
		]);
		file.writeInt32LE(0, 0xa);
		await expectDeclined(file);
	});

	it("rejects an empty name length", async () => {
		const file = buildPcd([
			{ name: "face/080", formatId: 0, body: Buffer.from("x") },
		]);
		file.writeInt32LE(0, INDEX_OFFSET + RECTANGLE_SIZE);
		await expectDeclined(file);
	});

	it("rejects an entry offset behind the file", async () => {
		const file = buildPcd([
			{ name: "face/090", formatId: 0, body: Buffer.from("x") },
		]);
		const offsetField =
			INDEX_OFFSET + RECTANGLE_SIZE + 4 + "face/090".length + 4 + 7;
		file.writeUInt32LE(file.length + 0x10, offsetField);
		await expectDeclined(file);
	});
});

/** Builds the 0x20 byte payload header of a frame. */
function bufferHeader(formatId: number, unpackedSize: number): Buffer {
	const header = Buffer.alloc(PAYLOAD_HEADER_SIZE);
	header.writeUInt32LE(formatId, 0);
	header.writeUInt32LE(unpackedSize, 4);
	return header;
}
