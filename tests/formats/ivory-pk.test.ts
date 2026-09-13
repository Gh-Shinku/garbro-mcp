import { encodeCp932 } from "@garbro-mcp/core";
import {
	ivoryKeySchedule,
	ivoryPkFormat,
	permuteIvory,
} from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

/**
 * The cipher decrypts by permuting a word and then exclusive-oring a key word, and the permutation is
 * its own inverse, so encrypting means permuting the word exclusive-ored with its key.
 */
function encryptIvory(data: Buffer, seed: number): Buffer {
	const schedule = ivoryKeySchedule(seed);
	const xored = Buffer.from(data);
	for (let index = 0; index < Math.trunc(xored.length / 4); index += 1) {
		const position = index * 4;
		xored.writeUInt32LE(
			(xored.readUInt32LE(position) ^ (schedule.key[index & 31] ?? 0)) >>> 0,
			position,
		);
	}
	return permuteIvory(xored, schedule);
}

interface Entry {
	name: string;
	content: Buffer;
}

const LIST_KEY = 0x11223344;
const NAME_KEY = 0x55667788;

/**
 * Lays out the head, a list section, a name section and a data section, then the payloads. Each section
 * header must be wide enough to hold its identifier, both lengths, and the fields read behind them.
 */
function buildIvory(entries: readonly Entry[], version: 1 | 2): Buffer {
	const longSize = version === 2 ? 8 : 4;
	const writeLong = (buffer: Buffer, value: number, position: number): void => {
		if (longSize === 8) buffer.writeBigInt64LE(BigInt(value), position);
		else buffer.writeUInt32LE(value, position);
	};
	const listHeaderSize = 16 + longSize * 2;
	const nameHeaderSize = 12 + longSize * 2;
	const dataHeaderSize = 4 + longSize * 2;

	const listContent = Buffer.alloc(entries.length * longSize * 3);
	const namePool = Buffer.concat(
		entries.map((entry) =>
			Buffer.concat([encodeCp932(entry.name), Buffer.from([0])]),
		),
	);
	const nameOffsets: number[] = [];
	let namePosition = 0;
	for (const entry of entries) {
		nameOffsets.push(namePosition);
		namePosition += encodeCp932(entry.name).length + 1;
	}

	const listSize = listHeaderSize + listContent.length;
	const nameSize = nameHeaderSize + namePool.length;
	// The payloads live inside the data section, which is why the archive ends with it: the reference
	// reads another section identifier as long as bytes remain, so trailing payload bytes would be
	// mistaken for a section header.
	const payloadSize = entries.reduce(
		(sum, entry) => sum + entry.content.length,
		0,
	);
	const dataSize = dataHeaderSize + payloadSize;
	const headSize = 4 + longSize;
	const baseOffset = headSize + listSize + nameSize + dataHeaderSize;

	let payloadPosition = baseOffset;
	const offsets: number[] = [];
	const payloads: Buffer[] = [];
	for (const entry of entries) {
		offsets.push(payloadPosition);
		payloads.push(entry.content);
		payloadPosition += entry.content.length;
	}
	for (const [index, entry] of entries.entries()) {
		const base = index * longSize * 3;
		writeLong(listContent, nameOffsets[index] ?? 0, base);
		writeLong(listContent, (offsets[index] ?? 0) - baseOffset, base + longSize);
		writeLong(listContent, entry.content.length, base + longSize * 2);
	}

	const head = Buffer.alloc(headSize);
	head.write(version === 2 ? "fPK2" : "fPK ", 0, "latin1");
	const list = Buffer.alloc(listSize);
	list.write("cLST", 0, "latin1");
	writeLong(list, listSize, 4);
	writeLong(list, listHeaderSize, 4 + longSize);
	list.writeUInt32LE(0, 4 + longSize * 2);
	list.writeInt32LE(entries.length, 8 + longSize * 2);
	list.writeUInt32LE(LIST_KEY, 12 + longSize * 2);
	encryptIvory(listContent, LIST_KEY).copy(list, listHeaderSize);

	const nameSection = Buffer.alloc(nameSize);
	nameSection.write("cNAM", 0, "latin1");
	writeLong(nameSection, nameSize, 4);
	writeLong(nameSection, nameHeaderSize, 4 + longSize);
	nameSection.writeUInt32LE(NAME_KEY, 8 + longSize * 2);
	encryptIvory(namePool, NAME_KEY).copy(nameSection, nameHeaderSize);

	const dataSection = Buffer.alloc(dataSize);
	dataSection.write("cDAT", 0, "latin1");
	writeLong(dataSection, dataSize, 4);
	writeLong(dataSection, dataHeaderSize, 4 + longSize);
	let writePosition = dataHeaderSize;
	for (const payload of payloads) {
		payload.copy(dataSection, writePosition);
		writePosition += payload.length;
	}

	const archive = Buffer.concat([head, list, nameSection, dataSection]);
	writeLong(archive, archive.length, 4);
	return archive;
}

describe("Ivory PK resource archive", () => {
	it("reads a version 1 index with encrypted sections", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: ivoryPkFormat,
			archive: buildIvory(
				[
					{ name: "one.dat", content: first },
					{ name: "two.px", content: second },
				],
				1,
			),
			sourcePath: "sample.pk",
			entries: [
				{ path: "one.dat", size: first.length, content: first },
				{ path: "two.px", size: second.length, content: second },
			],
		});
	});

	it("reads a version 2 index whose fields are longs", async () => {
		const content = Buffer.from("version two body");
		await expectArchive({
			format: ivoryPkFormat,
			archive: buildIvory([{ name: "wide.dat", content }], 2),
			sourcePath: "sample.pk",
			entries: [{ path: "wide.dat", size: content.length, content }],
		});
	});

	it("rejects a length word that does not match the file", async () => {
		const archive = buildIvory(
			[{ name: "one.dat", content: Buffer.from("body") }],
			1,
		);
		archive.writeUInt32LE(archive.length + 4, 4);
		await expectArchive({
			format: ivoryPkFormat,
			archive,
			sourcePath: "sample.pk",
			detected: false,
			entries: [],
		});
	});

	it("rejects a foreign signature", async () => {
		const archive = buildIvory(
			[{ name: "one.dat", content: Buffer.from("body") }],
			1,
		);
		archive.write("fPL ", 0, "latin1");
		await expectArchive({
			format: ivoryPkFormat,
			archive,
			sourcePath: "sample.pk",
			detected: false,
			entries: [],
		});
	});
});
