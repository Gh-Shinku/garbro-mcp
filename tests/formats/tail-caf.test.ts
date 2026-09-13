import { BufferByteSource } from "@garbro-mcp/core";
import { tailCafFormat, unpackCafEntry } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const HEADER_SIZE = 0x1c;
const INDEX_RECORD_SIZE = 0x14;
const PREN_CODE = 0xff;

interface CafSpec {
	dir?: string;
	name: string;
	payload: Buffer;
}

/** Builds a CAF archive: header, index, name blob, then the payload area. */
function buildArchive(specs: readonly CafSpec[]): Buffer {
	const indexSize = INDEX_RECORD_SIZE * specs.length;
	const indexOffset = HEADER_SIZE;
	const namesOffset = indexOffset + indexSize;
	const names: Buffer[] = [];
	const namesBlob = () => Buffer.concat(names);
	const records: { dirOffset: number; nameOffset: number }[] = [];
	for (const spec of specs) {
		let dirOffset = -1;
		if (spec.dir !== undefined) {
			dirOffset = names.reduce((sum, chunk) => sum + chunk.length, 0);
			names.push(Buffer.from(`${spec.dir}\0`, "latin1"));
		}
		const nameOffset = names.reduce((sum, chunk) => sum + chunk.length, 0);
		names.push(Buffer.from(`${spec.name}\0`, "latin1"));
		records.push({ dirOffset, nameOffset });
	}
	const blob = namesBlob();
	const namesSize = blob.length;
	const index = Buffer.alloc(indexSize);
	let dataOffset = 0;
	specs.forEach((spec, id) => {
		const record = records[id];
		if (!record) throw new Error("missing record");
		const base = id * INDEX_RECORD_SIZE;
		index.writeInt32LE(record.dirOffset, base + 4);
		index.writeInt32LE(record.nameOffset, base + 8);
		index.writeUInt32LE(dataOffset, base + 0xc);
		index.writeUInt32LE(spec.payload.length, base + 0x10);
		dataOffset += spec.payload.length;
	});
	const header = Buffer.alloc(HEADER_SIZE);
	header.write("CAF0", 0, "latin1");
	header.writeInt32LE(specs.length, 8);
	header.writeUInt32LE(indexOffset, 0xc);
	header.writeUInt32LE(indexSize, 0x10);
	header.writeUInt32LE(namesOffset, 0x14);
	header.writeUInt32LE(namesSize, 0x18);
	return Buffer.concat([header, index, blob, ...specs.map((s) => s.payload)]);
}

/** Encodes a PREN stream: literals, with the escape byte introducing run lengths. */
function encodePren(data: Buffer): Buffer {
	const body: number[] = [];
	for (const byte of data) body.push(byte);
	const header = Buffer.alloc(0x10);
	header.write("PREN", 0, "latin1");
	header.writeInt32LE(data.length, 8);
	header.writeUInt8(PREN_CODE, 0xc);
	return Buffer.concat([header, Buffer.from(body)]);
}

/** Encodes a CFP0 stream out of raw runs, repeats and back references. */
function encodeCfp0(unpackedSize: number, body: Buffer): Buffer {
	const header = Buffer.alloc(0xc);
	header.write("CFP0", 0, "latin1");
	header.writeInt32LE(unpackedSize, 8);
	return Buffer.concat([header, body]);
}

/** Encodes an HP stream with a two symbol tree: left is bit zero, right is bit one. */
function encodeHp(
	left: number,
	right: number,
	tokens: readonly number[],
): Buffer {
	const records: { node: number; left: number; right: number }[] = [
		{ node: 0x100, left, right },
	];
	records.push({ node: left, left: -1, right: 0 });
	if (right !== left) records.push({ node: right, left: -1, right: 0 });
	const header = Buffer.alloc(0x18);
	header.write("HP", 0, "latin1");
	header.writeInt32LE(tokens.length, 8);
	header.writeInt32LE(0x100, 0xc);
	header.writeInt32LE(records.length - (0x100 - 0xff), 0x10);
	header.writeInt32LE(tokens.length, 0x14);
	const body: Buffer[] = records.map((record) => {
		const node = Buffer.alloc(12);
		node.writeInt32LE(record.node, 0);
		node.writeInt32LE(record.left, 4);
		node.writeInt32LE(record.right, 8);
		return node;
	});
	const bits = Buffer.alloc(Math.ceil(tokens.length / 8));
	tokens.forEach((token, index) => {
		if (token === left) return;
		const position = index >> 3;
		bits[position] = (bits[position] ?? 0) | (0x80 >> (index & 7));
	});
	body.push(bits);
	return Buffer.concat([header, ...body]);
}

describe("Tail resource archive", () => {
	it("lists entries with directory prefixes", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		await expectArchive({
			format: tailCafFormat,
			archive: buildArchive([
				{ dir: "images", name: "first.dat", payload: first },
				{ name: "second.dat", payload: second },
			]),
			entries: [
				{ path: "images/first.dat", size: first.length, content: first },
				{ path: "second.dat", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("reuses a directory name", async () => {
		const payload = Buffer.from("payload");
		const archive = await tailCafFormat.open(
			new BufferByteSource(
				buildArchive([
					{ dir: "shared", name: "a.dat", payload },
					{ dir: "shared", name: "b.dat", payload },
				]),
			),
			"sample.caf",
		);
		expect(archive.entries.map((entry) => entry.path)).toEqual([
			"shared/a.dat",
			"shared/b.dat",
		]);
	});

	it("unpacks a pren run", async () => {
		const header = Buffer.alloc(0x10);
		header.write("PREN", 0, "latin1");
		header.writeInt32LE(9, 8);
		header.writeUInt8(PREN_CODE, 0xc);
		const body = Buffer.from([0x68, 0x69, PREN_CODE, 7, 0x21]);
		const stored = Buffer.concat([header, body]);
		await expectArchive({
			format: tailCafFormat,
			archive: buildArchive([{ name: "rle.dat", payload: stored }]),
			entries: [
				{
					path: "rle.dat",
					size: stored.length,
					content: Buffer.from("hi!!!!!!!"),
				},
			],
		});
	});

	it("unpacks cfp0 commands", async () => {
		// A raw run, a repeat, and a back reference that copies from the start of the output.
		const body = Buffer.from([
			0, 3, 0x61, 0x62, 0x63, 2, 2, 0x64, 6, 5, 0, 4, 0,
		]);
		const stored = encodeCfp0(9, body);
		expect(unpackCafEntry(stored)).toEqual(Buffer.from("abcddabcd"));
	});

	it("unpacks an hp tree", async () => {
		const stored = encodeHp(0x41, 0x42, [0x41, 0x42, 0x41, 0x41]);
		expect(unpackCafEntry(stored)).toEqual(Buffer.from("ABAA"));
	});

	it("unpacks chained layers", async () => {
		const inner = encodePren(Buffer.from("chained"));
		const raw = Buffer.concat([Buffer.from([0, inner.length]), inner]);
		expect(unpackCafEntry(encodeCfp0(inner.length, raw))).toEqual(
			Buffer.from("chained"),
		);
	});

	it("passes payloads with an unknown signature through", async () => {
		const stored = Buffer.from("plain payload bytes");
		expect(unpackCafEntry(stored)).toEqual(stored);
	});

	it("rejects a wrong signature", async () => {
		const file = buildArchive([
			{ name: "a.dat", payload: Buffer.from("payload") },
		]);
		file.write("CAP0", 0, "latin1");
		expect(await tailCafFormat.detect(new BufferByteSource(file))).toBe(false);
	});

	it("rejects an entry outside the archive", async () => {
		const file = buildArchive([
			{ name: "a.dat", payload: Buffer.from("payload") },
		]);
		file.writeUInt32LE(0x10000, HEADER_SIZE + 0xc);
		expect(await tailCafFormat.detect(new BufferByteSource(file))).toBe(false);
	});

	it("rejects an insane entry count", async () => {
		const file = buildArchive([
			{ name: "a.dat", payload: Buffer.from("payload") },
		]);
		file.writeInt32LE(0, 8);
		expect(await tailCafFormat.detect(new BufferByteSource(file))).toBe(false);
	});
});
