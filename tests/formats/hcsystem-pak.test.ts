import { BufferByteSource } from "@garbro-mcp/core";
import { hcsystemPakFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const INDEX_OFFSET = 0xc;
const NAME_SIZE_ASCII = 0x20;
const NAME_SIZE_UNICODE = 0x40;
const ENTRY_SIZE_ASCII = NAME_SIZE_ASCII + 0xc;
const ENTRY_SIZE_UNICODE = NAME_SIZE_UNICODE + 0xc;

interface Entry {
	name: string;
	/** Payload as stored; packed entries hold the LZSS stream. */
	stored: Buffer;
	unpacked?: Buffer;
}

function rotateNibbles(byte: number): number {
	return ((byte >>> 4) | (byte << 4)) & 0xff;
}

/** Builds a PAK with either the ASCII or the Unicode record layout and an optional encrypted index. */
function buildPak(
	entries: readonly Entry[],
	options: { unicode?: boolean; encrypted?: boolean } = {},
): Buffer {
	const unicode = options.unicode === true;
	const encrypted = options.encrypted === true;
	const nameSize = unicode ? NAME_SIZE_UNICODE : NAME_SIZE_ASCII;
	const entrySize = unicode ? ENTRY_SIZE_UNICODE : ENTRY_SIZE_ASCII;
	const dataOffset = INDEX_OFFSET + entrySize * entries.length;
	const payloadSize = entries.reduce(
		(sum, entry) => sum + entry.stored.length,
		0,
	);
	const archive = Buffer.alloc(dataOffset + payloadSize);
	archive.write("PACK", 0, "ascii");
	archive.writeInt32LE(entries.length, 4);
	archive[8] = encrypted ? 1 : 0;
	let payloadOffset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * entrySize;
		if (unicode) {
			Buffer.from(`${entry.name}\0`, "utf16le").copy(archive, record);
		} else {
			Buffer.from(entry.name, "latin1").copy(archive, record, 0, nameSize - 1);
		}
		const storedSize = entry.unpacked ? entry.stored.length : 0;
		archive.writeUInt32LE(
			entry.unpacked?.length ?? entry.stored.length,
			record + nameSize,
		);
		archive.writeUInt32LE(storedSize, record + nameSize + 4);
		archive.writeUInt32LE(payloadOffset, record + nameSize + 8);
		entry.stored.copy(archive, payloadOffset);
		payloadOffset += entry.stored.length;
	}
	if (encrypted) {
		// The reference rotates every index byte, including the first record's offset word, which it
		// un-rotates when it checks the index end.
		for (
			let position = INDEX_OFFSET;
			position < INDEX_OFFSET + entrySize * entries.length;
			position += 1
		) {
			archive[position] = rotateNibbles(archive[position] ?? 0);
		}
	}
	return archive;
}

describe("hcsystem PAK resource archive", () => {
	it("reads the ascii record layout", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		const archive = buildPak([
			{ name: "first.bin", stored: first },
			{ name: "second.bin", stored: second },
		]);
		await expectArchive({
			format: hcsystemPakFormat,
			archive,
			metadata: { entryCount: 2, encrypted: false, unicode: false },
			entries: [
				{ path: "first.bin", size: first.length, content: first },
				{ path: "second.bin", size: second.length, content: second },
			],
		});
	});

	it("reads the unicode record layout", async () => {
		const payload = Buffer.from("unicode named payload");
		const archive = buildPak([{ name: "名前.bin", stored: payload }], {
			unicode: true,
		});
		await expectArchive({
			format: hcsystemPakFormat,
			archive,
			metadata: { entryCount: 1, unicode: true },
			entries: [{ path: "名前.bin", size: payload.length, content: payload }],
		});
	});

	it("decodes packed entries", async () => {
		const unpacked = Buffer.from("lzss packed payload");
		const archive = buildPak([
			{
				name: "packed.bin",
				stored: literalLzssStream(unpacked),
				unpacked,
			},
		]);
		await expectArchive({
			format: hcsystemPakFormat,
			archive,
			entries: [
				{ path: "packed.bin", size: unpacked.length, content: unpacked },
			],
		});
	});

	it("reads an encrypted index", async () => {
		const payload = Buffer.from("encrypted index payload");
		const archive = buildPak([{ name: "one.bin", stored: payload }], {
			encrypted: true,
		});
		await expectArchive({
			format: hcsystemPakFormat,
			archive,
			metadata: { entryCount: 1, encrypted: true },
			entries: [{ path: "one.bin", size: payload.length, content: payload }],
		});
	});

	it("rejects a first offset that does not match the index end", async () => {
		const archive = buildPak([
			{ name: "one.bin", stored: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(0x1000, INDEX_OFFSET + ENTRY_SIZE_ASCII - 4);
		const source = new BufferByteSource(archive);
		expect(await hcsystemPakFormat.detect(source)).toBe(false);
	});

	it("rejects an entry that falls outside the archive", async () => {
		const archive = buildPak([
			{ name: "one.bin", stored: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(0x1000, INDEX_OFFSET + NAME_SIZE_ASCII + 8);
		const source = new BufferByteSource(archive);
		expect(await hcsystemPakFormat.detect(source)).toBe(false);
	});

	it("rejects a foreign signature", async () => {
		const archive = buildPak([
			{ name: "one.bin", stored: Buffer.from("payload") },
		]);
		archive.write("XXXX", 0, "ascii");
		const source = new BufferByteSource(archive);
		expect(await hcsystemPakFormat.detect(source)).toBe(false);
	});
});
