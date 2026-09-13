import { encodeCp932 } from "@garbro-mcp/core";
import { broomEncryptedPkFormat, broomPkFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 4;
const RECORD_SIZE = 0x18;
const COUNT_MASK = 0xff559977;
const OFFSET_MASK = 0x35846;
const SIZE_MASK = 0x57982525;
const NAME_KEY = Buffer.from([
	0xf5, 0xb2, 0xa4, 0x45, 0x59, 0x0f, 0x15, 0x22, 0x43, 0x0b, 0x99, 0x3c, 0xdd,
	0xe2,
]);

/** The plain variant stores sizes and names directly, and payload offsets accumulate. */
function buildPlain(
	entries: readonly { name: string; content: Buffer }[],
): Buffer {
	const indexSize = entries.length * RECORD_SIZE;
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeInt32LE(entries.length, 0);
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		archive.writeUInt32LE(entry.content.length, record + 4);
		encodeCp932(entry.name).copy(archive, record + 8);
		entry.content.copy(archive, position);
		position += entry.content.length;
	}
	return archive;
}

/** The encrypted variant folds the decrypted name bytes into a ten-bit checksum that masks both words. */
function buildEncrypted(
	entries: readonly { name: string; content: Buffer; offset: number }[],
): Buffer {
	const archive = Buffer.alloc(0x400);
	archive.writeUInt32LE((entries.length ^ COUNT_MASK) >>> 0, 0);
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		const name = Buffer.from(encodeCp932(entry.name));
		let checksum = 0;
		for (
			let position = 0;
			position < name.length && position < 14;
			position += 1
		)
			checksum += ((name[position] ?? 0) << ((position & 3) * 8)) >>> 0;
		checksum &= 0x3ff;
		archive.writeUInt32LE(
			(entry.offset ^ checksum ^ OFFSET_MASK) >>> 0,
			record,
		);
		archive.writeUInt32LE(
			(entry.content.length ^ checksum ^ SIZE_MASK) >>> 0,
			record + 4,
		);
		for (let position = 0; position < 14; position += 1) {
			const plain = name[position] ?? 0;
			archive.writeUInt8(
				(plain ^ (NAME_KEY[position] ?? 0)) & 0xff,
				record + 8 + position,
			);
		}
		entry.content.copy(archive, entry.offset);
	}
	return archive;
}

describe("Studio B-Room PK resource archives", () => {
	it("reads the plain variant with sequential payloads", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: broomPkFormat,
			archive: buildPlain([
				{ name: "one.dat", content: first },
				{ name: "two.dat", content: second },
			]),
			sourcePath: "sample.pk",
			entries: [
				{ path: "one.dat", size: first.length, content: first },
				{ path: "two.dat", size: second.length, content: second },
			],
		});
	});

	it("rejects the plain variant with trailing bytes", async () => {
		const archive = buildPlain([
			{ name: "one.dat", content: Buffer.from("body") },
		]);
		await expectArchive({
			format: broomPkFormat,
			archive: Buffer.concat([archive, Buffer.from([0])]),
			sourcePath: "sample.pk",
			detected: false,
			entries: [],
		});
	});

	it("decrypts the encrypted variant and rewrites the extension", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: broomEncryptedPkFormat,
			archive: buildEncrypted([
				{ name: "plain", content: first, offset: 0x100 },
				{ name: "named.e", content: second, offset: 0x200 },
			]),
			sourcePath: "sample.dat",
			entries: [
				{ path: "plain.Erp", size: first.length, content: first },
				{ path: "named.Erp", size: second.length, content: second },
			],
		});
	});

	it("rejects the encrypted variant with a bad count", async () => {
		const archive = buildEncrypted([
			{ name: "plain", content: Buffer.from("body"), offset: 0x100 },
		]);
		archive.writeUInt32LE(0, 0);
		await expectArchive({
			format: broomEncryptedPkFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});
});
