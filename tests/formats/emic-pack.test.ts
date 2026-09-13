import { encodeCp932 } from "@garbro-mcp/core";
import { emicFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x2c;
const KEY_SIZE = 0x20;

interface EmicEntry {
	name: string;
	content: Buffer;
}

function xorWithKey(data: Buffer, key: Buffer, startPosition: number): void {
	for (let position = 0; position < data.length; position += 1)
		data[position] =
			(data[position] ?? 0) ^
			(key[(startPosition + position) % key.length] ?? 0);
}

/**
 * Builds a `PACK` archive. The first header layout stores the count at 0x28 and the flag at 4 with a
 * key at 8; the key is masked with 0xAA before it is stored.
 */
function buildEmic(
	entries: readonly EmicEntry[],
	options: { encrypted: boolean; secondLayout?: boolean } = {
		encrypted: false,
	},
): Buffer {
	const count = entries.length;
	const records = entries.map((entry) => {
		const name = encodeCp932(entry.name);
		const record = Buffer.alloc(4 + name.length + 8);
		record.writeInt32LE(name.length, 0);
		name.copy(record, 4);
		record.writeUInt32LE(entry.content.length, 4 + name.length);
		return record;
	});
	const indexSize = records.reduce((sum, record) => sum + record.length, 0);
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("PACK", 0, "ascii");
	const key = Buffer.alloc(KEY_SIZE);
	for (let position = 0; position < KEY_SIZE; position += 1)
		key[position] = (position * 7 + 3) & 0xff;
	const keyOffset = options.secondLayout === true ? 0x0c : 8;
	const mask = options.secondLayout === true ? 0xab : 0xaa;
	for (const [position, value] of key.entries())
		archive[keyOffset + position] = value ^ mask;
	if (options.secondLayout === true) {
		archive.writeInt32LE(count, 4);
		archive.writeUInt32LE(options.encrypted ? 1 : 0, 8);
	} else {
		archive.writeInt32LE(count, 0x28);
		archive.writeUInt32LE(options.encrypted ? 1 : 0, 4);
	}
	let offset = dataOffset;
	let position = INDEX_OFFSET;
	for (const [id, record] of records.entries()) {
		record.writeUInt32LE(offset, record.length - 4);
		record.copy(archive, position);
		position += record.length;
		entries[id]?.content.copy(archive, offset);
		offset += entries[id]?.content.length ?? 0;
	}
	if (options.encrypted) {
		const body = Buffer.from(archive.subarray(INDEX_OFFSET));
		xorWithKey(body, key, INDEX_OFFSET);
		body.copy(archive, INDEX_OFFSET);
		// Payloads are stored encrypted with the key cycled from their own offset.
		let payload = dataOffset;
		for (const entry of entries) {
			const stored = Buffer.from(entry.content);
			xorWithKey(stored, key, payload);
			stored.copy(archive, payload);
			payload += entry.content.length;
		}
	}
	return archive;
}

describe("Emic engine PACK resource archive", () => {
	it("reads the primary header layout", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second!");
		await expectArchive({
			format: emicFormat,
			archive: buildEmic([
				{ name: "data/one.bin", content: first },
				{ name: "two.bin", content: second },
			]),
			sourcePath: "sample.pac",
			entries: [
				{ path: "data/one.bin", size: first.length, content: first },
				{ path: "two.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("reads the secondary header layout", async () => {
		const content = Buffer.from("secondary layout");
		await expectArchive({
			format: emicFormat,
			archive: buildEmic([{ name: "a.bin", content }], {
				encrypted: false,
				secondLayout: true,
			}),
			sourcePath: "sample.pac",
			entries: [{ path: "a.bin", size: content.length, content }],
		});
	});

	it("decrypts an encrypted archive", async () => {
		const content = Buffer.from("encrypted payload");
		await expectArchive({
			format: emicFormat,
			archive: buildEmic([{ name: "enc.bin", content }], { encrypted: true }),
			sourcePath: "sample.pac",
			entries: [{ path: "enc.bin", size: content.length, content }],
		});
	});

	it("requires the pac extension", async () => {
		await expectArchive({
			format: emicFormat,
			archive: buildEmic([{ name: "a.bin", content: Buffer.from("x") }]),
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});

	it("rejects a missing signature", async () => {
		const archive = buildEmic([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.write("PACL", 0, "ascii");
		await expectArchive({
			format: emicFormat,
			archive,
			sourcePath: "sample.pac",
			detected: false,
			entries: [],
		});
	});
});
