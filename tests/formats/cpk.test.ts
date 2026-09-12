import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { CpkFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

type UtfType = "u16" | "u32" | "u64" | "string" | "data";

interface UtfColumnDefinition {
	name: string;
	type: UtfType;
}

type UtfFixtureValue = number | bigint | string | Buffer;

const utfTypes: Record<UtfType, { code: number; width: number }> = {
	u16: { code: 0x02, width: 2 },
	u32: { code: 0x04, width: 4 },
	u64: { code: 0x06, width: 8 },
	string: { code: 0x0a, width: 4 },
	data: { code: 0x0b, width: 8 },
};

function buildUtf(
	columns: UtfColumnDefinition[],
	rows: Array<Record<string, UtfFixtureValue>>,
): Buffer {
	const strings: Buffer[] = [];
	let stringsLength = 0;
	const addString = (value: string): number => {
		const offset = stringsLength;
		const encoded = Buffer.from(`${value}\0`, "utf8");
		strings.push(encoded);
		stringsLength += encoded.length;
		return offset;
	};
	const tableNameOffset = addString("fixture");
	const nameOffsets = columns.map(({ name }) => addString(name));
	const stringValues = new Map<string, number>();
	for (const row of rows) {
		for (const column of columns) {
			if (column.type !== "string") continue;
			const value = row[column.name];
			if (typeof value !== "string") throw new Error("Expected a UTF string");
			if (!stringValues.has(value)) stringValues.set(value, addString(value));
		}
	}

	const schemaLength = columns.length * 5;
	const rowLength = columns.reduce(
		(total, column) => total + utfTypes[column.type].width,
		0,
	);
	const rowsOffset = 24 + schemaLength;
	const stringsOffset = rowsOffset + rowLength * rows.length;
	const dataValues: Buffer[] = [];
	let dataLength = 0;
	const dataLocations = new Map<Buffer, number>();
	for (const row of rows) {
		for (const column of columns) {
			if (column.type !== "data") continue;
			const value = row[column.name];
			if (!Buffer.isBuffer(value)) throw new Error("Expected UTF data");
			dataLocations.set(value, dataLength);
			dataValues.push(value);
			dataLength += value.length;
		}
	}
	const dataOffset = stringsOffset + stringsLength;
	const body = Buffer.alloc(dataOffset + dataLength);
	body.writeUInt32BE(rowsOffset, 0);
	body.writeUInt32BE(stringsOffset, 4);
	body.writeUInt32BE(dataOffset, 8);
	body.writeUInt32BE(tableNameOffset, 12);
	body.writeUInt16BE(columns.length, 16);
	body.writeUInt16BE(rowLength, 18);
	body.writeUInt32BE(rows.length, 20);
	for (const [index, column] of columns.entries()) {
		body[24 + index * 5] = 0x50 | utfTypes[column.type].code;
		body.writeUInt32BE(nameOffsets[index] ?? 0, 25 + index * 5);
	}

	let rowOffset = rowsOffset;
	for (const row of rows) {
		for (const column of columns) {
			const value = row[column.name];
			switch (column.type) {
				case "u16":
					body.writeUInt16BE(Number(value), rowOffset);
					rowOffset += 2;
					break;
				case "u32":
					body.writeUInt32BE(Number(value), rowOffset);
					rowOffset += 4;
					break;
				case "u64":
					body.writeBigUInt64BE(BigInt(value as number | bigint), rowOffset);
					rowOffset += 8;
					break;
				case "string":
					body.writeUInt32BE(stringValues.get(String(value)) ?? 0, rowOffset);
					rowOffset += 4;
					break;
				case "data": {
					if (!Buffer.isBuffer(value)) throw new Error("Expected UTF data");
					body.writeUInt32BE(dataLocations.get(value) ?? 0, rowOffset);
					body.writeUInt32BE(value.length, rowOffset + 4);
					rowOffset += 8;
					break;
				}
			}
		}
	}
	Buffer.concat(strings).copy(body, stringsOffset);
	Buffer.concat(dataValues).copy(body, dataOffset);
	const chunk = Buffer.alloc(8 + body.length);
	chunk.write("@UTF", 0, "ascii");
	chunk.writeUInt32BE(body.length, 4);
	body.copy(chunk, 8);
	return chunk;
}

function encryptUtf(chunk: Buffer): Buffer {
	const encrypted = Buffer.from(chunk);
	let key = 0x655f;
	for (let index = 0; index < encrypted.length; index += 1) {
		encrypted[index] = (encrypted[index] ?? 0) ^ (key & 0xff);
		key = Math.imul(key, 0x4115);
	}
	return encrypted;
}

function wrapChunk(marker: string, utf: Buffer): Buffer {
	const chunk = Buffer.alloc(16 + utf.length);
	chunk.write(marker, 0, "ascii");
	chunk.writeBigUInt64LE(BigInt(utf.length), 8);
	utf.copy(chunk, 16);
	return chunk;
}

function buildCrilayla(prefix: Buffer, suffix: Buffer): Buffer {
	const bits: number[] = [];
	for (const value of Buffer.from(suffix).reverse()) {
		bits.push(0);
		for (let shift = 7; shift >= 0; shift -= 1) bits.push((value >> shift) & 1);
	}
	const forward = Buffer.alloc(Math.ceil(bits.length / 8));
	for (const [index, bit] of bits.entries()) {
		forward[index >> 3] =
			(forward[index >> 3] ?? 0) | (bit << (7 - (index & 7)));
	}
	const packed = Buffer.from(forward).reverse();
	const output = Buffer.alloc(16 + packed.length + prefix.length);
	output.write("CRILAYLA", 0, "ascii");
	output.writeUInt32LE(suffix.length, 8);
	output.writeUInt32LE(packed.length, 12);
	packed.copy(output, 16);
	prefix.copy(output, 16 + packed.length);
	return output;
}

function buildTocArchive(): { archive: Buffer; contents: Buffer[] } {
	const plain = Buffer.from("plain CPK entry\n");
	const prefix = Buffer.from("CRI prefix");
	const suffix = Buffer.from("compressed suffix");
	const compressed = buildCrilayla(prefix, suffix);
	const contents: [Buffer, Buffer] = [plain, Buffer.concat([prefix, suffix])];
	const tocOffset = 0x400;
	const contentOffset = 0x1000;
	const entryOffsets: [number, number] = [contentOffset, 0x1100];
	const header = buildUtf(
		[
			{ name: "ContentOffset", type: "u64" },
			{ name: "TocOffset", type: "u64" },
		],
		[{ ContentOffset: contentOffset, TocOffset: tocOffset }],
	);
	const toc = buildUtf(
		[
			{ name: "ID", type: "u32" },
			{ name: "FileOffset", type: "u64" },
			{ name: "FileSize", type: "u32" },
			{ name: "ExtractSize", type: "u32" },
			{ name: "FileName", type: "string" },
			{ name: "DirName", type: "string" },
		],
		[
			{
				ID: 3,
				FileOffset: entryOffsets[0] - tocOffset,
				FileSize: plain.length,
				ExtractSize: plain.length,
				FileName: "plain.bin",
				DirName: "asset",
			},
			{
				ID: 7,
				FileOffset: entryOffsets[1] - tocOffset,
				FileSize: compressed.length,
				ExtractSize: contents[1].length,
				FileName: "packed.bin",
				DirName: "",
			},
		],
	);
	const archive = Buffer.alloc(entryOffsets[1] + compressed.length);
	wrapChunk("CPK ", encryptUtf(header)).copy(archive, 0);
	wrapChunk("TOC ", toc).copy(archive, tocOffset);
	plain.copy(archive, entryOffsets[0]);
	compressed.copy(archive, entryOffsets[1]);
	return { archive, contents };
}

function buildItocArchive(): { archive: Buffer; contents: Buffer[] } {
	const contents: [Buffer, Buffer] = [
		Buffer.from("one"),
		Buffer.from("second"),
	];
	const dataL = buildUtf(
		[
			{ name: "ID", type: "u16" },
			{ name: "FileSize", type: "u16" },
			{ name: "ExtractSize", type: "u16" },
		],
		contents.map((content, index) => ({
			ID: index + 1,
			FileSize: content.length,
			ExtractSize: content.length,
		})),
	);
	const dataH = buildUtf(
		[
			{ name: "ID", type: "u16" },
			{ name: "FileSize", type: "u32" },
			{ name: "ExtractSize", type: "u32" },
		],
		[],
	);
	const itoc = buildUtf(
		[
			{ name: "DataL", type: "data" },
			{ name: "DataH", type: "data" },
		],
		[{ DataL: dataL, DataH: dataH }],
	);
	const itocOffset = 0x400;
	const contentOffset = 0x1000;
	const alignment = 0x20;
	const header = buildUtf(
		[
			{ name: "ContentOffset", type: "u64" },
			{ name: "ItocOffset", type: "u64" },
			{ name: "Align", type: "u32" },
		],
		[
			{
				ContentOffset: contentOffset,
				ItocOffset: itocOffset,
				Align: alignment,
			},
		],
	);
	const secondOffset = contentOffset + alignment;
	const archive = Buffer.alloc(secondOffset + contents[1].length);
	wrapChunk("CPK ", header).copy(archive, 0);
	wrapChunk("ITOC", itoc).copy(archive, itocOffset);
	contents[0].copy(archive, contentOffset);
	contents[1].copy(archive, secondOffset);
	return { archive, contents };
}

describe("CRI CPK", () => {
	it("reads an encrypted header, named TOC entries, and CRILAYLA data", async () => {
		const fixture = buildTocArchive();
		const archive = await new CpkFormat().open(
			new BufferByteSource(fixture.archive),
			"sample.cpk",
		);
		try {
			expect(archive.entries).toMatchObject([
				{ id: "3", path: "asset/plain.bin", compressed: false },
				{ id: "7", path: "packed.bin", compressed: true },
			]);
			for (const [index, entry] of archive.entries.entries()) {
				expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
					fixture.contents[index],
				);
			}
		} finally {
			await archive.close();
		}
	});

	it("reads aligned unnamed entries from an ITOC", async () => {
		const fixture = buildItocArchive();
		const archive = await new CpkFormat().open(
			new BufferByteSource(fixture.archive),
			"sample.cpk",
		);
		try {
			expect(archive.metadata).toMatchObject({ hasNames: false });
			expect(archive.entries).toMatchObject([
				{ id: "1", path: "00001", offset: 0x1000n },
				{ id: "2", path: "00002", offset: 0x1020n },
			]);
			for (const [index, entry] of archive.entries.entries()) {
				expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
					fixture.contents[index],
				);
			}
		} finally {
			await archive.close();
		}
	});

	it("rejects a UTF chunk length outside the archive", async () => {
		const fixture = buildTocArchive().archive;
		fixture.writeBigUInt64LE(BigInt(fixture.length), 8);
		await expect(
			new CpkFormat().open(new BufferByteSource(fixture), "broken.cpk"),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
