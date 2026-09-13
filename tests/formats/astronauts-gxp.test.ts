import { gxpFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const COUNT_OFFSET = 0x18;
const BASE_OFFSET_OFFSET = 0x28;
const INDEX_OFFSET = 0x30;
const KEY = Buffer.from([
	0x40, 0x21, 0x28, 0x38, 0xa6, 0x6e, 0x43, 0xa5, 0x40, 0x21, 0x28, 0x38, 0xa6,
	0x43, 0xa5, 0x64, 0x3e, 0x65, 0x24, 0x20, 0x46, 0x6e, 0x74,
]);
const LENGTH_KEY =
	((KEY[0] ?? 0) |
		((1 ^ (KEY[1] ?? 0)) << 8) |
		((2 ^ (KEY[2] ?? 0)) << 16) |
		((3 ^ (KEY[3] ?? 0)) << 24)) >>>
	0;

/** The transform is its own inverse. */
function decrypt(data: Buffer): void {
	for (let position = 0; position < data.length; position += 1)
		data[position] =
			(data[position] ?? 0) ^
			(position ^ ((KEY[position % KEY.length] ?? 0) & 0xff));
}

interface GxpEntry {
	name: string;
	content: Buffer;
}

function buildGxp(entries: readonly GxpEntry[]): Buffer {
	const names = entries.map((entry) => Buffer.from(entry.name, "utf16le"));
	const recordSizes = names.map((name) => 0x20 + name.length);
	const indexSize = recordSizes.reduce((sum, size) => sum + size, 0);
	const baseOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		baseOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("GXP", 0, "ascii");
	archive.writeInt32LE(entries.length, COUNT_OFFSET);
	archive.writeBigInt64LE(BigInt(baseOffset), BASE_OFFSET_OFFSET);
	let recordPosition = INDEX_OFFSET;
	let payloadPosition = baseOffset;
	let relative = 0n;
	for (const [id, entry] of entries.entries()) {
		const name = names[id] ?? Buffer.alloc(0);
		const recordSize = recordSizes[id] ?? 0;
		const record = archive.subarray(
			recordPosition,
			recordPosition + recordSize,
		);
		record.writeUInt32LE(entry.content.length, 4);
		record.writeInt32LE(name.length / 2, 0x0c);
		record.writeBigInt64LE(relative, 0x18);
		name.copy(record, 0x20);
		decrypt(record);
		// The record length itself is read obfuscated, before the record is decrypted.
		record.writeUInt32LE(recordSize ^ LENGTH_KEY, 0);
		const stored = Buffer.from(entry.content);
		for (let index = 0; index < stored.length; index += 1)
			stored[index] =
				(stored[index] ?? 0) ^
				(index ^ ((KEY[index % KEY.length] ?? 0) & 0xff));
		stored.copy(archive, payloadPosition);
		recordPosition += recordSize;
		payloadPosition += stored.length;
		relative += BigInt(stored.length);
	}
	return archive;
}

describe("Astronauts GXP resource archive", () => {
	it("reads keyed records with UTF-16 names", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second!");
		await expectArchive({
			format: gxpFormat,
			archive: buildGxp([
				{ name: "data/one.bin", content: first },
				{ name: "音声.wav", content: second },
			]),
			sourcePath: "sample.gxp",
			entries: [
				{ path: "data/one.bin", size: first.length, content: first },
				{ path: "音声.wav", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a missing signature", async () => {
		const archive = buildGxp([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.write("GXQ", 0, "ascii");
		await expectArchive({
			format: gxpFormat,
			archive,
			sourcePath: "sample.gxp",
			detected: false,
			entries: [],
		});
	});
});
