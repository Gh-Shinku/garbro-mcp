import { encodeCp932 } from "@garbro-mcp/core";
import { pkgFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const NAME_SIZE = 0x80;
const RECORD_SIZE = NAME_SIZE + 8;
const INDEX_OFFSET = 8;

function xorWithKey(data: Buffer, key: Buffer): void {
	for (let position = 0; position < data.length; position += 1) {
		data[position] = (data[position] ?? 0) ^ (key[position % key.length] ?? 0);
	}
}

/** Pads to four bytes so payload offsets stay aligned with the repeating key. */
function pad4(data: Buffer): Buffer {
	const remainder = data.length % 4;
	return remainder === 0
		? data
		: Buffer.concat([data, Buffer.alloc(4 - remainder)]);
}

function buildPkg(
	entries: readonly { name: string; content: Buffer }[],
	keyValue: number,
): Buffer {
	const count = entries.length;
	const dataOffset = INDEX_OFFSET + count * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset +
			entries.reduce((sum, entry) => sum + pad4(entry.content).length, 0),
	);
	archive.writeUInt32LE(count, 4);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		const stored = pad4(entry.content);
		archive.writeUInt32LE(stored.length, record + NAME_SIZE);
		archive.writeUInt32LE(offset, record + NAME_SIZE + 4);
		entry.content.copy(archive, position);
		offset += stored.length;
		position += stored.length;
	}
	// The plaintext is XOR-encrypted in place; the trailing key bytes of the first two name fields
	// become the repeated key that GARbro reads back from the encrypted file.
	const key = Buffer.alloc(4);
	key.writeUInt32LE(keyValue, 0);
	xorWithKey(archive, key);
	return archive;
}

describe("Yatagarasu PKG archive", () => {
	it("reads the key from the name fields and decrypts index and payloads", async () => {
		const keyValue = 0x1a2b3c4d;
		const first = Buffer.from("first payload");
		const second = Buffer.from("second");
		await expectArchive({
			format: pkgFormat,
			archive: buildPkg(
				[
					{ name: "graphic/a.bin", content: first },
					{ name: "b.bin", content: second },
				],
				keyValue,
			),
			sourcePath: "sample.pkg",
			entries: [
				{
					path: "graphic/a.bin",
					size: pad4(first).length,
					content: pad4(first),
				},
				{ path: "b.bin", size: pad4(second).length, content: pad4(second) },
			],
			metadata: { entryCount: 2, key: keyValue },
		});
	});

	it("requires the pkg extension", async () => {
		const archive = buildPkg([{ name: "a.bin", content: Buffer.from("a") }], 7);
		await expectArchive({
			format: pkgFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});

	it("rejects mismatched key fields", async () => {
		const archive = buildPkg(
			[
				{ name: "a.bin", content: Buffer.from("a") },
				{ name: "b.bin", content: Buffer.from("b") },
			],
			7,
		);
		// The second name field must repeat the key exactly.
		archive.writeUInt32LE(0x11223344, 0x10c);
		await expectArchive({
			format: pkgFormat,
			archive,
			sourcePath: "sample.pkg",
			detected: false,
			entries: [],
		});
	});
});
