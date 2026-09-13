import { encodeCp932 } from "@garbro-mcp/core";
import { azuriteFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 4;

interface Entry {
	name: string;
	stored: Buffer;
	unpackedSize: number;
}

/**
 * Names are obfuscated with a key that starts at the name length and decreases, and GARbro adds that
 * key while decrypting, so the stored form subtracts it.
 */
function encryptName(name: string): Buffer {
	const encoded = Buffer.from(encodeCp932(name));
	for (let index = 0; index < encoded.length; index += 1)
		encoded[index] = ((encoded[index] ?? 0) - (encoded.length - index)) & 0xff;
	return encoded;
}

function buildAzurite(entries: readonly Entry[]): Buffer {
	const records = entries.map((entry) => {
		const name = encryptName(entry.name);
		const words = Buffer.alloc(12);
		words.writeUInt32BE(entry.stored.length, 0);
		words.writeUInt32BE(entry.unpackedSize, 4);
		return { name, words, stored: entry.stored };
	});
	const indexSize = records.reduce(
		(sum, record) => sum + 1 + record.name.length + 12,
		0,
	);
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset + records.reduce((sum, r) => sum + r.stored.length, 0),
	);
	archive.writeUInt32LE(indexSize, 0);
	let position = INDEX_OFFSET;
	let data = dataOffset;
	for (const record of records) {
		archive[position] = record.name.length;
		position += 1;
		record.name.copy(archive, position);
		position += record.name.length;
		record.words.writeUInt32BE(data, 8);
		record.words.copy(archive, position);
		position += 12;
		record.stored.copy(archive, data);
		data += record.stored.length;
	}
	return archive;
}

describe("Silky's Azurite resource archive", () => {
	it("reads plain and packed entries", async () => {
		const plain = Buffer.from("plain body");
		// The default LZSS settings decode this literal-and-match stream to five 'A' characters.
		const stream = Buffer.from([0x01, 0x41, 0xee, 0xf1]);
		await expectArchive({
			format: azuriteFormat,
			archive: buildAzurite([
				{ name: "plain.dat", stored: plain, unpackedSize: plain.length },
				{ name: "packed.dat", stored: stream, unpackedSize: 5 },
			]),
			sourcePath: "sample.arc",
			entries: [
				{ path: "plain.dat", size: plain.length, content: plain },
				{ path: "packed.dat", size: 5, content: Buffer.from("AAAAA") },
			],
		});
	});

	it("requires the arc extension", async () => {
		const plain = Buffer.from("plain body");
		await expectArchive({
			format: azuriteFormat,
			archive: buildAzurite([
				{ name: "a.dat", stored: plain, unpackedSize: plain.length },
			]),
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});

	it("rejects an index smaller than ten bytes", async () => {
		const plain = Buffer.from("plain body");
		const archive = buildAzurite([
			{ name: "a.dat", stored: plain, unpackedSize: plain.length },
		]);
		archive.writeUInt32LE(4, 0);
		await expectArchive({
			format: azuriteFormat,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});

	it("rejects a data offset inside the index", async () => {
		const plain = Buffer.from("plain body");
		const archive = buildAzurite([
			{ name: "a.dat", stored: plain, unpackedSize: plain.length },
		]);
		// The offset word sits behind the name, which is the last three words of the index.
		const nameLength = archive[INDEX_OFFSET] ?? 0;
		archive.writeUInt32BE(INDEX_OFFSET, INDEX_OFFSET + 1 + nameLength + 8);
		await expectArchive({
			format: azuriteFormat,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});
});
