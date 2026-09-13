import { BufferByteSource } from "@garbro-mcp/core";
import { parsleyCgV1Format, parsleyYanepackFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const YANE_INDEX_START = 0xc;
const YANE_RECORD_SIZE = 0x28;
const YANE_NAME_SIZE = 0x20;
const CG_INDEX_START = 4;

interface Payload {
	name: string;
	data: Buffer;
}

/** Lays out a YaneSDK archive with a fixed size record per entry. */
function buildYanepack(
	payloads: readonly Payload[],
	options?: { marker?: string; firstOffset?: number },
): Buffer {
	const indexStart = YANE_INDEX_START;
	const indexLength = payloads.length * YANE_RECORD_SIZE;
	const dataStart = indexStart + indexLength;
	const records = Buffer.alloc(indexLength);
	let offset = dataStart;
	payloads.forEach((payload, id) => {
		const base = id * YANE_RECORD_SIZE;
		records.write(payload.name, base, "latin1");
		records.writeUInt32LE(offset, base + YANE_NAME_SIZE);
		records.writeUInt32LE(payload.data.length, base + YANE_NAME_SIZE + 4);
		offset += payload.data.length;
	});
	const header = Buffer.alloc(indexStart);
	header.write(options?.marker ?? "yanepack", 0, "latin1");
	header.writeInt32LE(payloads.length, 8);
	const file = Buffer.concat([header, records, ...payloads.map((p) => p.data)]);
	// The first record doubles as the index end marker.
	file.writeUInt32LE(
		options?.firstOffset ?? dataStart,
		indexStart + YANE_NAME_SIZE,
	);
	return file;
}

/** Lays out a Parsley CG archive with NUL terminated names and derived sizes. */
function buildCgV1(payloads: readonly Payload[]): Buffer {
	const names = payloads.map((payload) => Buffer.from(payload.name, "latin1"));
	const indexLength =
		CG_INDEX_START +
		names.reduce((size, name) => size + name.length + 1 + 4, 0);
	const records = names.map((name, id) => {
		const record = Buffer.alloc(name.length + 1 + 4);
		name.copy(record, 0);
		record.writeUInt32LE(
			indexLength +
				payloads
					.slice(0, id)
					.reduce((size, payload) => size + payload.data.length, 0),
			name.length + 1,
		);
		return record;
	});
	const header = Buffer.alloc(CG_INDEX_START);
	header.writeInt32LE(payloads.length, 0);
	return Buffer.concat([
		header,
		...records,
		...payloads.map((payload) => payload.data),
	]);
}

describe("Parsley CG archive", () => {
	it("reads a YaneSDK index", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		await expectArchive({
			format: parsleyYanepackFormat,
			sourcePath: "data.dat",
			archive: buildYanepack([
				{ name: "a.bmp", data: first },
				{ name: "b.bmp", data: second },
			]),
			entries: [
				{ path: "a.bmp", size: first.length, content: first },
				{ path: "b.bmp", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("accepts archives without the marker", async () => {
		const payload = Buffer.from("payload");
		await expectArchive({
			format: parsleyYanepackFormat,
			archive: buildYanepack([{ name: "a.bmp", data: payload }], {
				marker: "",
			}),
			entries: [{ path: "a.bmp", size: payload.length, content: payload }],
		});
	});

	it("rejects a truncated marker", async () => {
		const file = buildYanepack([{ name: "a.bmp", data: Buffer.from("x") }], {
			marker: "yaneXXXX",
		});
		expect(await parsleyYanepackFormat.detect(new BufferByteSource(file))).toBe(
			false,
		);
	});

	it("rejects a wrong first offset", async () => {
		const file = buildYanepack([{ name: "a.bmp", data: Buffer.from("x") }], {
			firstOffset: 0x40,
		});
		expect(await parsleyYanepackFormat.detect(new BufferByteSource(file))).toBe(
			false,
		);
	});

	it("rejects an entry outside the file", async () => {
		const file = buildYanepack([{ name: "a.bmp", data: Buffer.from("x") }]);
		file.writeUInt32LE(0x1000, YANE_INDEX_START + YANE_NAME_SIZE + 4);
		expect(await parsleyYanepackFormat.detect(new BufferByteSource(file))).toBe(
			false,
		);
	});

	it("rejects an empty entry name", async () => {
		const file = buildYanepack([{ name: "", data: Buffer.from("x") }]);
		expect(await parsleyYanepackFormat.detect(new BufferByteSource(file))).toBe(
			false,
		);
	});

	it("reads a CG index", async () => {
		const first = Buffer.from("cg payload one");
		const second = Buffer.from("cg payload two");
		await expectArchive({
			format: parsleyCgV1Format,
			sourcePath: "CG",
			archive: buildCgV1([
				{ name: "CG#0000.bmp", data: first },
				{ name: "CG#0001.bmp", data: second },
			]),
			entries: [
				{ path: "CG#0000.bmp", size: first.length, content: first },
				{ path: "CG#0001.bmp", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("types CG entries as images", async () => {
		const payload = Buffer.from("cg payload");
		const file = buildCgV1([{ name: "CG#0000.bmp", data: payload }]);
		const archive = await parsleyCgV1Format.open(
			new BufferByteSource(file),
			"CG",
		);
		expect(archive.entries[0]?.metadata?.type).toBe("image");
	});

	it("marks UCG entries as packed", async () => {
		const payload = Buffer.from("ucg payload");
		const file = buildCgV1([{ name: "CG#0000.bmp", data: payload }]);
		const archive = await parsleyCgV1Format.open(
			new BufferByteSource(file),
			"ucg0.bin",
		);
		expect(archive.entries[0]).toMatchObject({
			path: "CG#0000.bmp",
			compressed: true,
			sizeKnown: false,
			metadata: { type: "image" },
		});
	});

	it("leaves other archive names untyped", async () => {
		const payload = Buffer.from("plain payload");
		const file = buildCgV1([{ name: "a.dat", data: payload }]);
		const archive = await parsleyCgV1Format.open(
			new BufferByteSource(file),
			"data.bin",
		);
		expect(archive.entries[0]?.metadata?.type).toBeUndefined();
		expect(archive.entries[0]?.compressed).not.toBe(true);
	});

	it("rejects an offset inside the index", async () => {
		const name = "CG#0000.bmp";
		const file = buildCgV1([{ name, data: Buffer.from("x") }]);
		file.writeUInt32LE(0, CG_INDEX_START + name.length + 1);
		expect(
			await parsleyCgV1Format.detect(new BufferByteSource(file), "CG"),
		).toBe(false);
	});

	it("rejects an over long name", async () => {
		const file = buildCgV1([
			{ name: "a".repeat(0x101), data: Buffer.from("x") },
		]);
		expect(
			await parsleyCgV1Format.detect(new BufferByteSource(file), "CG"),
		).toBe(false);
	});

	it("rejects an empty index", async () => {
		const file = buildCgV1([]);
		expect(
			await parsleyCgV1Format.detect(new BufferByteSource(file), "CG"),
		).toBe(false);
	});
});
