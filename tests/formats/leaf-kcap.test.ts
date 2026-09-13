import { BufferByteSource } from "@garbro-mcp/core";
import { leafKcapFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

interface Spec {
	name: string;
	payload: Buffer;
	packed?: boolean;
}

/** Lays out a version zero archive: LZSS payloads and no packed flag. */
function buildV0(specs: readonly Spec[]): Buffer {
	const recordSize = 0x20;
	const indexStart = 8;
	const dataStart = indexStart + specs.length * recordSize;
	const records = Buffer.alloc(specs.length * recordSize);
	const payloads: Buffer[] = [];
	let offset = dataStart;
	specs.forEach((spec, id) => {
		const base = id * recordSize;
		// Every version stores an eight byte payload header in front of the LZSS stream.
		const stored =
			spec.payload.length === 0
				? Buffer.alloc(0)
				: Buffer.concat([Buffer.alloc(8), literalLzssStream(spec.payload)]);
		records.write(spec.name, base, "latin1");
		records.writeUInt32LE(offset, base + 0x18);
		records.writeUInt32LE(stored.length, base + 0x1c);
		payloads.push(stored);
		offset += stored.length;
	});
	const prefix = Buffer.alloc(indexStart);
	prefix.write("KCAP", 0, "latin1");
	prefix.writeInt32LE(specs.length, 4);
	return Buffer.concat([prefix, records, ...payloads]);
}

/** Lays out a version one archive with a packed flag in front of each name. */
function buildV1(
	specs: readonly Spec[],
	options?: { shifted?: boolean },
): Buffer {
	const recordSize = 0x24;
	const indexStart = options?.shifted ? 0xc : 8;
	const dataStart = indexStart + specs.length * recordSize;
	const records = Buffer.alloc(specs.length * recordSize);
	const payloads: Buffer[] = [];
	let offset = dataStart;
	specs.forEach((spec, id) => {
		const base = id * recordSize;
		const stored = spec.packed
			? Buffer.concat([Buffer.alloc(8), literalLzssStream(spec.payload)])
			: spec.payload;
		records.writeInt32LE(spec.packed ? 1 : 0, base);
		records.write(spec.name, base + 4, "latin1");
		records.writeUInt32LE(offset, base + 0x1c);
		records.writeUInt32LE(stored.length, base + 0x20);
		payloads.push(stored);
		offset += stored.length;
	});
	const prefix = Buffer.alloc(indexStart);
	prefix.write("KCAP", 0, "latin1");
	prefix.writeInt32LE(specs.length, options?.shifted ? 8 : 4);
	return Buffer.concat([prefix, records, ...payloads]);
}

/** Lays out a version two archive with a crc and an unpacked size per record. */
function buildV2(specs: readonly Spec[]): Buffer {
	const recordSize = 0x2c;
	const indexStart = 0x10;
	const dataStart = indexStart + specs.length * recordSize;
	const records = Buffer.alloc(specs.length * recordSize);
	const payloads: Buffer[] = [];
	let offset = dataStart;
	specs.forEach((spec, id) => {
		const base = id * recordSize;
		const stored = spec.packed
			? Buffer.concat([Buffer.alloc(8), literalLzssStream(spec.payload)])
			: spec.payload;
		records.writeInt32LE(spec.packed ? 1 : 0, base);
		records.write(spec.name, base + 4, "latin1");
		records.writeUInt32LE(0, base + 0x1c);
		records.writeUInt32LE(spec.payload.length, base + 0x20);
		records.writeUInt32LE(offset, base + 0x24);
		records.writeUInt32LE(stored.length, base + 0x28);
		payloads.push(stored);
		offset += stored.length;
	});
	const prefix = Buffer.alloc(indexStart);
	prefix.write("KCAP", 0, "latin1");
	prefix.writeInt32LE(specs.length, 12);
	return Buffer.concat([prefix, records, ...payloads]);
}

describe("Leaf resource archive", () => {
	it("reads a version zero archive", async () => {
		const first = Buffer.from("first leaf payload");
		const second = Buffer.from("second");
		await expectArchive({
			format: leafKcapFormat,
			sourcePath: "data.pak",
			archive: buildV0([
				{ name: "a.bmp", payload: first },
				{ name: "b.bmp", payload: second },
			]),
			entries: [
				{
					path: "a.bmp",
					size: 8 + literalLzssStream(first).length,
					content: first,
				},
				{
					path: "b.bmp",
					size: 8 + literalLzssStream(second).length,
					content: second,
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("skips records without a payload", async () => {
		const kept = Buffer.from("kept");
		const file = buildV0([
			{ name: "a.bmp", payload: kept },
			{ name: "empty.bmp", payload: Buffer.alloc(0) },
		]);
		const archive = await leafKcapFormat.open(
			new BufferByteSource(file),
			"data.pak",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["a.bmp"]);
		} finally {
			await archive.close();
		}
	});

	it("reads a version one archive", async () => {
		const packed = Buffer.from("packed leaf payload");
		const plain = Buffer.from("plain leaf payload");
		await expectArchive({
			format: leafKcapFormat,
			sourcePath: "data.pak",
			archive: buildV1([
				{ name: "a.bmp", payload: packed, packed: true },
				{ name: "b.wav", payload: plain },
			]),
			entries: [
				{
					path: "a.bmp",
					size: Buffer.alloc(8).length + literalLzssStream(packed).length,
					content: packed,
				},
				{ path: "b.wav", size: plain.length, content: plain },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("reads a shifted version one archive", async () => {
		const packed = Buffer.from("shifted payload");
		const plain = Buffer.from("plain shifted");
		await expectArchive({
			format: leafKcapFormat,
			archive: buildV1(
				[
					{ name: "a.bmp", payload: packed, packed: true },
					{ name: "b.wav", payload: plain },
				],
				{ shifted: true },
			),
			entries: [
				{
					path: "a.bmp",
					size: Buffer.alloc(8).length + literalLzssStream(packed).length,
					content: packed,
				},
				{ path: "b.wav", size: plain.length, content: plain },
			],
		});
	});

	it("reads a version two archive", async () => {
		const packed = Buffer.from("version two payload");
		const plain = Buffer.from("stored version two");
		await expectArchive({
			format: leafKcapFormat,
			archive: buildV2([
				{ name: "a.tga", payload: packed, packed: true },
				{ name: "b.ogg", payload: plain },
			]),
			entries: [
				{
					path: "a.tga",
					size: Buffer.alloc(8).length + literalLzssStream(packed).length,
					content: packed,
				},
				{ path: "b.ogg", size: plain.length, content: plain },
			],
		});
	});

	it("registers the kcap signature", () => {
		const signatures = leafKcapFormat.detection?.signatures ?? [];
		expect(Buffer.from(signatures[0]?.bytes ?? []).toString("latin1")).toBe(
			"KCAP",
		);
	});

	it("rejects a wrong marker", async () => {
		const file = buildV0([{ name: "a.bmp", payload: Buffer.from("x") }]);
		file.write("KCAB", 0, "latin1");
		expect(await leafKcapFormat.detect(new BufferByteSource(file))).toBe(false);
	});

	it("rejects an unknown layout", async () => {
		const file = buildV0([{ name: "a.bmp", payload: Buffer.from("x") }]);
		file.writeUInt32LE(0x40, 0x20);
		expect(await leafKcapFormat.detect(new BufferByteSource(file))).toBe(false);
	});

	it("rejects an entry outside the file", async () => {
		const file = buildV0([
			{ name: "a.bmp", payload: Buffer.from("x") },
			{ name: "b.bmp", payload: Buffer.from("y") },
		]);
		file.writeUInt32LE(0x1000, 8 + 0x1c);
		expect(await leafKcapFormat.detect(new BufferByteSource(file))).toBe(false);
	});

	it("rejects an empty index", async () => {
		const file = buildV0([
			{ name: "a.bmp", payload: Buffer.alloc(0) },
			{ name: "b.bmp", payload: Buffer.alloc(0) },
		]);
		expect(await leafKcapFormat.detect(new BufferByteSource(file))).toBe(false);
	});

	it("rejects a truncated header", async () => {
		const file = buildV0([{ name: "a.bmp", payload: Buffer.from("x") }]);
		expect(
			await leafKcapFormat.detect(new BufferByteSource(file.subarray(0, 4))),
		).toBe(false);
	});
});
