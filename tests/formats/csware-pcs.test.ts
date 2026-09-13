import { BufferByteSource } from "@garbro-mcp/core";
import { pcsFormat, shuffleBlocks } from "@garbro-mcp/formats";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const SIGNATURE = "PCCS";
const INDEX_OFFSET = 0x10;
const FOOTER_SIZE = 0x10;
const DECRYPT_SIZE = 512;

interface Spec {
	name: string;
	payload: Buffer;
}

function rotate(value: number): number {
	return ((value << 4) | (value >> 4)) & 0xff;
}

/** The inverse of the payload and footer scramble, which is its own inverse. */
function scrambleByte(base: number, mask: number, value: number): number {
	return (base + mask - value) & 0xff;
}

function checksumOf(name: string): {
	plain: Buffer;
	rotated: Buffer;
	checksum: number;
} {
	const plain = Buffer.from(name, "latin1");
	const rotated = Buffer.from(plain);
	let checksum = 0;
	for (const [index, byte] of rotated.entries()) {
		rotated[index] = rotate(byte);
		checksum = (checksum + byte) & 0xff;
	}
	return { plain, rotated, checksum };
}

/** The store side applies the inverse of the block permutation the reference decodes with. */
function unshuffle(input: Buffer, key: number): Buffer {
	const blockSize = input.length >>> 5;
	const order = shuffleBlocks(
		Buffer.from(Array.from({ length: 32 }, (_, index) => index)),
		key,
	);
	const output = Buffer.alloc(input.length);
	for (let block = 0; block < 32; block += 1) {
		// The decoder reads block j into position i, so storing writes position i to block j.
		const destination = (order[block] ?? 0) * blockSize;
		input.copy(
			output,
			destination,
			block * blockSize,
			block * blockSize + blockSize,
		);
	}
	const tail = blockSize << 5;
	if (tail !== input.length) input.copy(output, tail, tail, input.length);
	return output;
}

function nameHashOf(plain: Buffer): number {
	return createHash("sha1")
		.update(plain.subarray(0, plain.length - 1))
		.digest()
		.readUInt32BE(0);
}

/** Lays out a C's ware archive, shuffling the index and scrambling payloads for version 6. */
function buildPcs(
	specs: readonly Spec[],
	version: number,
	shuffleKey = 0x1234,
): Buffer {
	const records = specs.map((spec) => {
		const { plain, rotated, checksum } = checksumOf(spec.name);
		return { spec, plain, rotated, checksum };
	});
	// The first pass measures the records so that the payload area can be addressed.
	const lengths = records.map((record) => {
		const nameField = 5 + record.rotated.length;
		const altField = version > 1 ? nameField : 0;
		return altField + nameField + FOOTER_SIZE;
	});
	const indexSize = lengths.reduce((total, length) => total + length, 0);
	const dataOffset = INDEX_OFFSET + indexSize;
	const index = Buffer.alloc(indexSize);
	let position = 0;
	let payloadOffset = dataOffset;
	const payloads: Buffer[] = [];
	for (const record of records) {
		const { spec, plain, rotated, checksum } = record;
		if (version > 1) {
			index.writeInt32LE(rotated.length, position);
			rotated.copy(index, position + 5);
			position += 5 + rotated.length;
		}
		index.writeInt32LE(rotated.length, position);
		rotated.copy(index, position + 5);
		position += 5 + rotated.length;
		const footer = Buffer.alloc(FOOTER_SIZE);
		footer.writeUInt32LE(payloadOffset - dataOffset, 0);
		footer.writeUInt32LE(spec.payload.length, 4);
		if (version >= 4) {
			const base = (-1 - checksum) & 0xff;
			for (let step = 0; step < 4; step += 1) {
				const mask = (checksum + (17 << step)) & 0x33;
				for (const extra of [0, 4])
					footer[step + extra] = scrambleByte(
						base,
						mask,
						footer[step + extra] ?? 0,
					);
			}
		}
		footer.copy(index, position);
		position += FOOTER_SIZE;
		let payload: Buffer = Buffer.from(spec.payload);
		if (version >= 4) {
			const key = checksum;
			payload = Buffer.from(payload);
			const headerSize = Math.min(payload.length, DECRYPT_SIZE);
			for (let at = 0; at < headerSize; at += 1)
				payload[at] = (key - (payload[at] ?? 0) - 1) & 0xff;
			if (version === 6) {
				const head = unshuffle(
					payload.subarray(0, headerSize),
					nameHashOf(plain),
				);
				head.copy(payload, 0);
			}
		}
		payloads.push(payload);
		payloadOffset += spec.payload.length;
	}
	const stored = version === 6 ? unshuffle(index, shuffleKey) : index;
	const header = Buffer.alloc(INDEX_OFFSET);
	header.write(SIGNATURE, 0, "latin1");
	header.writeUInt16LE(version, 4);
	header.writeUInt16LE(shuffleKey, 6);
	header.writeInt32LE(specs.length, 8);
	header.writeUInt32LE(dataOffset, 0xc);
	return Buffer.concat([header, stored, ...payloads]);
}

async function expectDeclined(file: Buffer): Promise<void> {
	expect(await pcsFormat.detect(new BufferByteSource(file), "sample.pcs")).toBe(
		false,
	);
}

describe("C's ware resource archive", () => {
	it("reads a version 1 archive", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload bytes");
		await expectArchive({
			format: pcsFormat,
			sourcePath: "sample.pcs",
			archive: buildPcs(
				[
					{ name: "first.dat", payload: first },
					{ name: "second.dat", payload: second },
				],
				1,
			),
			entries: [
				{ path: "first.dat", size: first.length, content: first },
				{ path: "second.dat", size: second.length, content: second },
			],
			metadata: { entryCount: 2, version: 1 },
		});
	});

	it("walks the repeated name field of a version 2 archive", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		await expectArchive({
			format: pcsFormat,
			sourcePath: "sample.pcs",
			archive: buildPcs(
				[
					{ name: "first.dat", payload: first },
					{ name: "second.dat", payload: second },
				],
				2,
			),
			entries: [
				{ path: "first.dat", size: first.length, content: first },
				{ path: "second.dat", size: second.length, content: second },
			],
		});
	});

	it("unscrambles payloads and footers from version 4 on", async () => {
		const short = Buffer.from("short payload");
		const long = Buffer.alloc(700);
		for (let index = 0; index < long.length; index += 1)
			long[index] = (index * 7) & 0xff;
		await expectArchive({
			format: pcsFormat,
			sourcePath: "sample.pcs",
			archive: buildPcs(
				[
					{ name: "short.dat", payload: short },
					{ name: "long.dat", payload: long },
				],
				4,
			),
			entries: [
				{ path: "short.dat", size: short.length, content: short },
				{ path: "long.dat", size: long.length, content: long },
			],
		});
	});

	it("unshuffles an index and payload headers from version 6", async () => {
		const first = Buffer.from("version six first payload");
		const long = Buffer.alloc(640);
		for (let index = 0; index < long.length; index += 1)
			long[index] = (index * 11) & 0xff;
		await expectArchive({
			format: pcsFormat,
			sourcePath: "sample.pcs",
			archive: buildPcs(
				[
					{ name: "first.dat", payload: first },
					{ name: "long.dat", payload: long },
				],
				6,
				0xbeef,
			),
			entries: [
				{ path: "first.dat", size: first.length, content: first },
				{ path: "long.dat", size: long.length, content: long },
			],
			metadata: { entryCount: 2, version: 6 },
		});
	});

	it("keeps the payload tail of a shuffled archive", async () => {
		const payload = Buffer.alloc(600);
		for (let index = 0; index < payload.length; index += 1)
			payload[index] = index & 0xff;
		await expectArchive({
			format: pcsFormat,
			sourcePath: "sample.pcs",
			archive: buildPcs([{ name: "tail.dat", payload }], 6, 7),
			entries: [{ path: "tail.dat", size: payload.length, content: payload }],
		});
	});

	it("rejects an unknown version", async () => {
		const file = buildPcs(
			[{ name: "first.dat", payload: Buffer.from("x") }],
			1,
		);
		file.writeUInt16LE(7, 4);
		await expectDeclined(file);
		file.writeUInt16LE(0, 4);
		await expectDeclined(file);
	});

	it("rejects an archive without entries", async () => {
		const file = buildPcs(
			[{ name: "first.dat", payload: Buffer.from("x") }],
			1,
		);
		file.writeInt32LE(0, 8);
		await expectDeclined(file);
	});

	it("rejects a zero name length", async () => {
		const file = buildPcs(
			[{ name: "first.dat", payload: Buffer.from("x") }],
			1,
		);
		file.writeInt32LE(0, INDEX_OFFSET);
		await expectDeclined(file);
	});

	it("rejects an index that runs into the payload area", async () => {
		const file = buildPcs(
			[{ name: "first.dat", payload: Buffer.from("x") }],
			1,
		);
		file.writeUInt32LE(INDEX_OFFSET, 0xc);
		await expectDeclined(file);
	});

	it("rejects an entry that leaves the file", async () => {
		const file = buildPcs(
			[
				{ name: "first.dat", payload: Buffer.from("first") },
				{ name: "second.dat", payload: Buffer.from("second") },
			],
			1,
		);
		// The first record's declared size is the third word of its footer.
		const footer = INDEX_OFFSET + 5 + "first.dat".length;
		file.writeUInt32LE(0xffff, footer + 4);
		await expectDeclined(file);
	});

	it("shuffles blocks as a permutation", async () => {
		const input = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
		const output = shuffleBlocks(input, 4357);
		expect([...output].sort((left, right) => left - right)).toEqual([...input]);
	});
});
