import { encodeCp932 } from "@garbro-mcp/core";
import { cpcFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const COUNT_XOR = 0xff559977;
const INDEX_OFFSET = 12;
const RECORD_SIZE = 0x38;
const NAME_SIZE = 0x30;
const NAME_KEY = Buffer.from([
	0x13, 0x60, 0xfc, 0x4d, 0xde, 0xd0, 0x79, 0xb3, 0x51, 0xc5, 0xec, 0x9e, 0x06,
	0x82, 0x63, 0x73, 0x21, 0xab, 0xbf, 0x1a, 0x32, 0x9c, 0xba, 0xfa, 0x5d, 0xff,
	0x29, 0x25, 0xb8, 0x7f, 0xcf, 0xf4, 0x75, 0x93, 0x05, 0x40, 0x0c, 0xa3, 0x6a,
	0x04, 0x98, 0x67, 0x47, 0xef, 0x8b, 0xad, 0x56, 0x65,
]);
const INDEX_KEY = [
	0x27f6, 0x940b, 0x611f, 0xd845, 0xe733, 0xe871, 0x8a11, 0x360e, 0xc7aa,
	0x31bb, 0xb23a, 0xc957, 0x28d2, 0xbf73, 0x1dff, 0x29eb, 0xd3c2, 0x6cc6,
	0xdf7b, 0xa22e, 0xb82b, 0x9256, 0xceec, 0xdc08, 0xa96a, 0xe52d, 0x5f96,
	0x7959, 0x81a4, 0x990d, 0x6826, 0xaf38, 0x1b01, 0x2a19, 0x679d, 0x494e,
	0x555c, 0xe623, 0xb797, 0x6214, 0x3cad, 0xdecd, 0x775b, 0x16a7, 0x37cc,
	0xe3ae, 0xd6d5, 0x9f9b, 0x8c1e, 0xcaf3, 0x8bb1, 0x6dc5, 0x1320, 0xba1a,
	0x42bc, 0xed2f, 0xdab9, 0xa89c, 0x53f9, 0x4691, 0xf4e4, 0xfbd1, 0xe982,
	0xbeb4,
];
const OFFSET_KEY = [0x89d9a054, 0x74e297e9, 0xeeca074f, 0xf2a42ce8, 0x2d6fbe0e];
const LENGTH_KEY = [0x101c2885, 0x5f7e52f8, 0x3812a6b4, 0x99696ca1, 0x6b0ba9a7];
const PLAIN_OFFSET_XOR = 0x35846;
const PLAIN_SIZE_XOR = 0x57982525;

interface CpcEntry {
	name: string;
	content: Buffer;
}

/** Builds an archive; the transform is symmetric, so encryption equals decryption. */
function buildCpc(
	entries: readonly CpcEntry[],
	options: { encrypted: boolean; keyIndex?: number } = { encrypted: false },
): Buffer {
	const count = entries.length;
	const keyIndex = options.keyIndex ?? 2;
	const dataOffset = INDEX_OFFSET + count * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("CPCG", 0, "ascii");
	archive.writeUInt32LE((count ^ COUNT_XOR) >>> 0, 4);
	archive.writeUInt8(options.encrypted ? 0x8a ^ 1 : 0x8a, 8);
	archive.writeUInt8(0xce ^ keyIndex, 9);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		let storedOffset = offset;
		let storedSize = entry.content.length;
		if (options.encrypted) {
			const key = INDEX_KEY[id & 0x3f] ?? 0;
			storedOffset = (storedOffset ^ key ^ (OFFSET_KEY[keyIndex] ?? 0)) >>> 0;
			storedSize = (storedSize ^ key ^ (LENGTH_KEY[keyIndex] ?? 0)) >>> 0;
		} else {
			storedOffset = (storedOffset ^ id ^ PLAIN_OFFSET_XOR) >>> 0;
			storedSize = (storedSize ^ id ^ PLAIN_SIZE_XOR) >>> 0;
		}
		archive.writeUInt32LE(storedOffset, record);
		archive.writeUInt32LE(storedSize, record + 4);
		const name = encodeCp932(entry.name);
		for (const [index, value] of name.entries())
			archive[record + 8 + index] = value ^ (NAME_KEY[index] ?? 0);
		archive[record + 8 + name.length] = NAME_KEY[name.length] ?? 0;
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Studio B-Room CPC resource archive", () => {
	it("reads an unencrypted index", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second!");
		await expectArchive({
			format: cpcFormat,
			archive: buildCpc([
				{ name: "data/one.bin", content: first },
				{ name: "two.bin", content: second },
			]),
			sourcePath: "sample.cpc",
			entries: [
				{ path: "data/one.bin", size: first.length, content: first },
				{ path: "two.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("reads an encrypted index", async () => {
		const content = Buffer.from("secret payload");
		await expectArchive({
			format: cpcFormat,
			archive: buildCpc([{ name: "enc.bin", content }], {
				encrypted: true,
				keyIndex: 4,
			}),
			sourcePath: "sample.cpc",
			entries: [{ path: "enc.bin", size: content.length, content }],
		});
	});

	it("rejects a key index beyond the tables", async () => {
		const archive = buildCpc([{ name: "a.bin", content: Buffer.from("x") }], {
			encrypted: true,
			keyIndex: 5,
		});
		await expectArchive({
			format: cpcFormat,
			archive,
			sourcePath: "sample.cpc",
			detected: false,
			entries: [],
		});
	});

	it("rejects a missing signature", async () => {
		const archive = buildCpc([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.write("CPCH", 0, "ascii");
		await expectArchive({
			format: cpcFormat,
			archive,
			sourcePath: "sample.cpc",
			detected: false,
			entries: [],
		});
	});
});
