import { encodeCp932 } from "@garbro-mcp/core";
import { cpz1Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x10;
const KEY = Buffer.from([
	0x92, 0xcd, 0x97, 0x90, 0x8c, 0xd7, 0x8c, 0xd5, 0x8b, 0x4b, 0x93, 0xfa, 0x9a,
	0xd7, 0x8c, 0xbf, 0x8c, 0xc9, 0x8c, 0xeb, 0x8d, 0x69, 0x8d, 0x8b, 0x8c, 0xd2,
	0x8c, 0xd6, 0x8b, 0x6d, 0x8c, 0xe3, 0x8c, 0xfb, 0x8c, 0xd0, 0x8c, 0xc8, 0x8c,
	0xf0, 0x8b, 0xfe, 0x8c, 0xaa, 0x8c, 0xf4, 0x8b, 0x4b, 0x9c, 0x58, 0x8c, 0xd3,
	0x96, 0xc8, 0x8c, 0xcb, 0x8c, 0xce, 0x8c, 0xf3, 0x8c, 0xd6, 0x8b, 0x52,
]);

/** Inverse of GARbro's `DecryptData`: add 0x6c, then XOR with the repeating key. */
function encryptData(data: Buffer): void {
	for (let position = 0; position < data.length; position += 1) {
		data[position] =
			(((data[position] ?? 0) + 0x6c) & 0xff) ^ (KEY[position & 0x3f] ?? 0);
	}
}

interface CpzEntry {
	name: string;
	content: Buffer;
}

function buildCpz1(entries: readonly CpzEntry[]): Buffer {
	const records = entries.map((entry) => {
		const name = encodeCp932(entry.name);
		const size = 0x18 + name.length + 1;
		const record = Buffer.alloc(size);
		record.writeInt32LE(size, 0);
		record.writeUInt32LE(entry.content.length, 4);
		name.copy(record, 0x18);
		return record;
	});
	const indexSize = records.reduce((sum, record) => sum + record.length, 0);
	const baseOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.concat([
		Buffer.alloc(baseOffset),
		...entries.map((entry) => entry.content),
	]);
	archive.write("CPZ1", 0, "ascii");
	archive.writeInt32LE(entries.length, 4);
	archive.writeUInt32LE(indexSize, 8);
	const index = Buffer.alloc(indexSize);
	// Data offsets are stored relative to the end of the index.
	let offset = 0;
	let position = 0;
	for (const [id, record] of records.entries()) {
		record.writeUInt32LE(offset, 8);
		record.copy(index, position);
		position += record.length;
		offset += entries[id]?.content.length ?? 0;
	}
	encryptData(index);
	index.copy(archive, INDEX_OFFSET);
	for (const [id, entry] of entries.entries()) {
		const payload = Buffer.from(entry.content);
		encryptData(payload);
		payload.copy(
			archive,
			baseOffset +
				entries
					.slice(0, id)
					.reduce((sum, previous) => sum + previous.content.length, 0),
		);
	}
	return archive;
}

describe("CVNS CPZ1 resource archive", () => {
	it("decrypts the index and payloads", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second!");
		await expectArchive({
			format: cpz1Format,
			archive: buildCpz1([
				{ name: "data/one.bin", content: first },
				{ name: "two.bin", content: second },
			]),
			sourcePath: "sample.cpz",
			entries: [
				{ path: "data/one.bin", size: first.length, content: first },
				{ path: "two.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("unpacks PSS0 payloads with their declared size", async () => {
		const plain = Buffer.from("literal lzss data");
		// A literals-only stream: one control byte per group of up to eight bytes.
		const stream: number[] = [];
		for (let position = 0; position < plain.length; position += 8) {
			const group = plain.subarray(position, position + 8);
			stream.push((1 << group.length) - 1, ...group);
		}
		const header = Buffer.alloc(0x30);
		header.write("PSS0", 0, "ascii");
		header.writeInt32LE(plain.length, 0x28);
		const payload = Buffer.concat([header, Buffer.from(stream)]);
		await expectArchive({
			format: cpz1Format,
			archive: buildCpz1([{ name: "packed.bin", content: payload }]),
			sourcePath: "sample.cpz",
			entries: [
				{
					path: "packed.bin",
					size: 0x30 + plain.length,
					content: Buffer.concat([header, plain]),
				},
			],
		});
	});

	it("rejects a missing signature", async () => {
		const archive = buildCpz1([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.write("CPZ2", 0, "ascii");
		await expectArchive({
			format: cpz1Format,
			archive,
			sourcePath: "sample.cpz",
			detected: false,
			entries: [],
		});
	});

	it("requires the cpz extension", async () => {
		await expectArchive({
			format: cpz1Format,
			archive: buildCpz1([{ name: "a.bin", content: Buffer.from("x") }]),
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});
});
