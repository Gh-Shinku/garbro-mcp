import { encodeCp932 } from "@garbro-mcp/core";
import { ai6WinFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 4;
const NAME_SIZE = 0x104;
const RECORD_SIZE = NAME_SIZE + 12;

/**
 * Names are obfuscated with a key that starts at the name length plus one and decreases, and GARbro
 * subtracts that key while decrypting, so the stored form adds it.
 */
function encryptName(name: string): Buffer {
	const encoded = Buffer.from(encodeCp932(name));
	const field = Buffer.alloc(NAME_SIZE);
	for (let index = 0; index < encoded.length; index += 1) {
		const key = (encoded.length + 1 - index) & 0xff;
		field[index] = ((encoded[index] ?? 0) + key) & 0xff;
	}
	return field;
}

interface Entry {
	name: string;
	stored: Buffer;
	unpackedSize: number;
}

function buildAi6Win(entries: readonly Entry[]): Buffer {
	const indexSize = RECORD_SIZE * entries.length;
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.stored.length, 0),
	);
	archive.writeInt32LE(entries.length, 0);
	let position = INDEX_OFFSET;
	let data = dataOffset;
	for (const entry of entries) {
		encryptName(entry.name).copy(archive, position);
		archive.writeUInt32BE(entry.stored.length, position + NAME_SIZE);
		archive.writeUInt32BE(entry.unpackedSize, position + NAME_SIZE + 4);
		archive.writeUInt32BE(data, position + NAME_SIZE + 8);
		entry.stored.copy(archive, data);
		position += RECORD_SIZE;
		data += entry.stored.length;
	}
	return archive;
}

describe("Silky AI6WIN resource archive", () => {
	it("reads plain and packed entries", async () => {
		const plain = Buffer.from("plain body");
		// With the default LZSS settings this literal-and-match stream decodes to five 'A' characters.
		const stream = Buffer.from([0x01, 0x41, 0xee, 0xf1]);
		await expectArchive({
			format: ai6WinFormat,
			archive: buildAi6Win([
				{ name: "dir/plain.dat", stored: plain, unpackedSize: plain.length },
				{ name: "packed.dat", stored: stream, unpackedSize: 5 },
			]),
			sourcePath: "sample.arc",
			entries: [
				{ path: "dir/plain.dat", size: plain.length, content: plain },
				{ path: "packed.dat", size: 5, content: Buffer.from("AAAAA") },
			],
		});
	});

	it("requires the arc extension", async () => {
		const plain = Buffer.from("plain body");
		await expectArchive({
			format: ai6WinFormat,
			archive: buildAi6Win([
				{ name: "a.dat", stored: plain, unpackedSize: plain.length },
			]),
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});

	it("rejects a name with a character invalid in a file name", async () => {
		const plain = Buffer.from("plain body");
		await expectArchive({
			format: ai6WinFormat,
			archive: buildAi6Win([
				{ name: "bad:name.dat", stored: plain, unpackedSize: plain.length },
			]),
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});

	it("rejects a data offset inside the index", async () => {
		const plain = Buffer.from("plain body");
		const archive = buildAi6Win([
			{ name: "a.dat", stored: plain, unpackedSize: plain.length },
		]);
		archive.writeUInt32BE(INDEX_OFFSET, INDEX_OFFSET + NAME_SIZE + 8);
		await expectArchive({
			format: ai6WinFormat,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});
});
