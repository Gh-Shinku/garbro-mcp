import { BufferByteSource } from "@garbro-mcp/core";
import { cherryPak2Format, cherryPakFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const CHERRY_HEADER_SIZE = 8;
const CHERRY2_SIGNATURE_2 = "CHERRY PACK 2.0\0";
const CHERRY2_SIGNATURE_3 = "CHERRY PACK 3.0\0";
const CHERRY2_HEADER_SIZE = 0x1c;
const RECORD_SIZE = 0x18;
const SCRIPT_OFFSET_FIELD = 0x5c;
const GROUP_SUFFIX = "GRP";
const SCRIPT_SIGNATURE = "GsWIN SC File";
const SCRIPT_SIZE_FIELD = 0x60;
const SCRIPT_TEXT_OFFSET = 0x68;
const COUNT_KEY = 0xbc138744;
const BASE_OFFSET_KEY = 0x64e0ba23;

interface Spec {
	name: string;
	payload: Buffer;
}

/** The inverse of the pair transform, which swaps the two keys as well as the bytes. */
function encryptPairs(input: Buffer, index: number, length: number): Buffer {
	const output = Buffer.from(input);
	for (let position = 0; position + 1 < length; position += 2) {
		const lo = (output[index + position] ?? 0) ^ 0xcc;
		const hi = (output[index + position + 1] ?? 0) ^ 0x33;
		output[index + position] = hi;
		output[index + position + 1] = lo;
	}
	return output;
}

/** An all literal lzss stream, which stores every byte behind a set control bit. */
function lzssLiterals(data: Buffer): Buffer {
	const parts: number[] = [];
	for (let start = 0; start < data.length; start += 8) {
		const group = data.subarray(start, start + 8);
		let control = 0;
		for (let index = 0; index < group.length; index += 1) control |= 1 << index;
		parts.push(control, ...group);
	}
	return Buffer.from(parts);
}

function buildCherry(specs: readonly Spec[]): Buffer {
	const baseOffset = CHERRY_HEADER_SIZE + specs.length * RECORD_SIZE;
	const header = Buffer.alloc(CHERRY_HEADER_SIZE);
	header.writeInt32LE(specs.length, 0);
	header.writeUInt32LE(baseOffset, 4);
	const index = Buffer.alloc(specs.length * RECORD_SIZE);
	const payloads: Buffer[] = [];
	let offset = 0;
	for (const [id, spec] of specs.entries()) {
		const position = id * RECORD_SIZE;
		index.write(spec.name, position, "latin1");
		index.writeUInt32LE(offset, position + 0x10);
		index.writeUInt32LE(spec.payload.length, position + 0x14);
		payloads.push(spec.payload);
		offset += spec.payload.length;
	}
	return Buffer.concat([header, index, ...payloads]);
}

interface Cherry2Options {
	version?: number;
	compressed?: boolean;
	encryptedHeader?: boolean;
	encryptedPayloads?: boolean;
}

function buildCherry2(
	specs: readonly Spec[],
	options: Cherry2Options = {},
): Buffer {
	const version = options.version ?? 2;
	const compressed = options.compressed ?? false;
	const encryptedHeader = options.encryptedHeader ?? false;
	const encryptedPayloads = options.encryptedPayloads ?? false;
	const signature = version === 3 ? CHERRY2_SIGNATURE_3 : CHERRY2_SIGNATURE_2;
	const index = Buffer.alloc(specs.length * RECORD_SIZE);
	const payloads: Buffer[] = [];
	let offset = 0;
	for (const [id, spec] of specs.entries()) {
		const position = id * RECORD_SIZE;
		const payload = encryptedPayloads
			? encryptPairs(spec.payload, 0, spec.payload.length)
			: spec.payload;
		index.write(spec.name, position, "latin1");
		index.writeUInt32LE(offset, position + 0x10);
		index.writeUInt32LE(payload.length, position + 0x14);
		payloads.push(payload);
		offset += payload.length;
	}
	const header = Buffer.alloc(CHERRY2_HEADER_SIZE);
	header.write(signature, 0, "latin1");
	header.writeInt32LE(compressed ? 1 : 0, 0x10);
	let count = specs.length;
	let baseOffset: number;
	let middle: Buffer;
	if (compressed) {
		const packed = lzssLiterals(index);
		middle = encryptPairs(packed, 0, packed.length);
		baseOffset = CHERRY2_HEADER_SIZE + middle.length;
		if (encryptedHeader) {
			count = (count ^ COUNT_KEY) | 0;
			baseOffset ^= BASE_OFFSET_KEY;
		}
	} else {
		middle = index;
		baseOffset = CHERRY2_HEADER_SIZE + middle.length;
	}
	header.writeInt32LE(count, 0x14);
	header.writeUInt32LE(baseOffset >>> 0, 0x18);
	return Buffer.concat([header, middle, ...payloads]);
}

describe("Cherry Soft PACK resource archive", () => {
	it("lists a plain archive and reads stored payloads", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload bytes");
		await expectArchive({
			format: cherryPakFormat,
			sourcePath: "sample.pak",
			archive: buildCherry([
				{ name: "first.dat", payload: first },
				{ name: "second.dat", payload: second },
			]),
			entries: [
				{ path: "first.dat", size: first.length, content: first },
				{ path: "second.dat", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("unkeys a script payload", async () => {
		const text = "the script text";
		const payload = Buffer.alloc(SCRIPT_TEXT_OFFSET + 0x10 + text.length);
		payload.write(SCRIPT_SIGNATURE, 0, "latin1");
		payload.writeUInt32LE(0x10, SCRIPT_OFFSET_FIELD);
		payload.writeUInt32LE(text.length, SCRIPT_SIZE_FIELD);
		const expected = Buffer.from(payload);
		const plain = Buffer.from(text, "latin1");
		for (const [index, byte] of plain.entries())
			payload[SCRIPT_TEXT_OFFSET + 0x10 + index] = byte ^ (index & 0xff);
		plain.copy(expected, SCRIPT_TEXT_OFFSET + 0x10);
		await expectArchive({
			format: cherryPakFormat,
			sourcePath: "sample.pak",
			archive: buildCherry([{ name: "script.scn", payload }]),
			entries: [
				{ path: "script.scn", size: payload.length, content: expected },
			],
		});
	});

	it("renames entries of a grp archive", async () => {
		const payload = Buffer.from("grp payload");
		const archive = await cherryPakFormat.open(
			new BufferByteSource(buildCherry([{ name: "face.bmp", payload }])),
			`sample${GROUP_SUFFIX}.pak`,
		);
		expect(archive.entries[0]?.path).toBe("face.grp");
		expect(archive.entries[0]?.metadata?.type).toBe("image");
	});

	it("lists a version two archive with a plain index", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload bytes");
		await expectArchive({
			format: cherryPak2Format,
			sourcePath: "sample.pak",
			archive: buildCherry2([
				{ name: "first.dat", payload: first },
				{ name: "second.dat", payload: second },
			]),
			entries: [
				{ path: "first.dat", size: first.length, content: first },
				{ path: "second.dat", size: second.length, content: second },
			],
		});
	});

	it("unpacks a compressed index", async () => {
		const first = Buffer.from("compressed archive payload");
		const second = Buffer.from("another payload");
		await expectArchive({
			format: cherryPak2Format,
			sourcePath: "sample.pak",
			archive: buildCherry2(
				[
					{ name: "first.dat", payload: first },
					{ name: "second.dat", payload: second },
				],
				{ compressed: true },
			),
			entries: [
				{ path: "first.dat", size: first.length, content: first },
				{ path: "second.dat", size: second.length, content: second },
			],
		});
	});

	it("keys the header of an encrypted archive", async () => {
		const payload = Buffer.alloc(0x20);
		for (let index = 0; index < payload.length; index += 1)
			payload[index] = (index * 11 + 1) & 0xff;
		const plain = Buffer.from(payload);
		for (const word of [
			{ offset: 0, key: 0xa53cc35a },
			{ offset: 4, key: 0x35421005 },
			{ offset: 0x10, key: 0xcf42355d },
		]) {
			payload.writeUInt32LE(
				(payload.readUInt32LE(word.offset) ^ word.key) >>> 0,
				word.offset,
			);
		}
		const stored = encryptPairs(payload, 0x18, payload.length - 0x18);
		await expectArchive({
			format: cherryPak2Format,
			sourcePath: "sample.pak",
			archive: buildCherry2([{ name: "first.dat", payload: stored }], {
				compressed: true,
				encryptedHeader: true,
				encryptedPayloads: false,
			}),
			entries: [{ path: "first.dat", size: plain.length, content: plain }],
		});
	});

	it("marks entries of an encrypted archive", async () => {
		const payload = Buffer.from("a short stored payload");
		const file = buildCherry2([{ name: "first.dat", payload }], {
			compressed: true,
			encryptedHeader: true,
			encryptedPayloads: true,
		});
		const archive = await cherryPak2Format.open(
			new BufferByteSource(file),
			"sample.pak",
		);
		expect(archive.entries[0]?.encrypted).toBe(true);
	});

	it("accepts a version three marker", async () => {
		const payload = Buffer.from("version three payload");
		await expectArchive({
			format: cherryPak2Format,
			sourcePath: "sample.pak",
			archive: buildCherry2([{ name: "first.dat", payload }], {
				version: 3,
			}),
			entries: [{ path: "first.dat", size: payload.length, content: payload }],
		});
	});

	it("rejects a misplaced cherry index", async () => {
		const file = buildCherry([
			{ name: "first.dat", payload: Buffer.from("payload") },
		]);
		file.writeUInt32LE(0x40, 4);
		expect(
			await cherryPakFormat.detect(new BufferByteSource(file), "a.pak"),
		).toBe(false);
	});

	it("rejects a cherry archive without entries", async () => {
		const file = buildCherry([
			{ name: "first.dat", payload: Buffer.from("payload") },
		]);
		file.writeInt32LE(0, 0);
		expect(
			await cherryPakFormat.detect(new BufferByteSource(file), "a.pak"),
		).toBe(false);
	});

	it("rejects a foreign cherry2 signature", async () => {
		const file = buildCherry2([
			{ name: "first.dat", payload: Buffer.from("payload") },
		]);
		file.write("CHERRY PACK 4.0\0", 0, "latin1");
		expect(
			await cherryPak2Format.detect(new BufferByteSource(file), "a.pak"),
		).toBe(false);
	});

	it("rejects an encrypted header without the keys", async () => {
		const file = buildCherry2(
			[{ name: "first.dat", payload: Buffer.from("payload") }],
			{ compressed: true },
		);
		file.writeInt32LE(0x7fffffff, 0x14);
		expect(
			await cherryPak2Format.detect(new BufferByteSource(file), "a.pak"),
		).toBe(false);
	});
});
