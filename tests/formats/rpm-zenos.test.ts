import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { rpmArcFormat, rpmZenosFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";
import { describe, expect, it } from "vitest";

const COUNT_OFFSET = 0;
const INDEX_OFFSET = 4;
const NAME_SIZE = 0x10;

/** Mirrors GARbro `ArcIndexReader.DecryptIndex` by subtracting the keyword when encrypting. */
function encryptIndex(index: Buffer, keyword: string): Buffer {
	const encrypted = Buffer.from(index);
	for (let position = 0; position < encrypted.length; position += 1) {
		encrypted[position] =
			((encrypted[position] ?? 0) -
				keyword.charCodeAt(position % keyword.length)) &
			0xff;
	}
	return encrypted;
}

function buildZenos(
	entries: readonly { name: string; content: Buffer }[],
	keyword: string,
): Buffer {
	const count = entries.length;
	const stored = entries.map((entry) => literalLzssStream(entry.content));
	const indexSize = count * (NAME_SIZE + 12);
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset + stored.reduce((sum, payload) => sum + payload.length, 0),
	);
	archive.writeInt32LE(count, COUNT_OFFSET);
	const index = Buffer.alloc(indexSize);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const payload = stored[id] ?? Buffer.alloc(0);
		const record = id * (NAME_SIZE + 12);
		encodeCp932(entry.name).copy(index, record);
		index.writeUInt32LE(entry.content.length, record + NAME_SIZE);
		index.writeUInt32LE(payload.length, record + NAME_SIZE + 4);
		index.writeUInt32LE(offset, record + NAME_SIZE + 8);
		offset += payload.length;
		payload.copy(archive, position);
		position += payload.length;
	}
	encryptIndex(index, keyword).copy(archive, INDEX_OFFSET);
	return archive;
}

describe("Zenos archive", () => {
	it("reads a 0x10-byte index and decompresses every entry", async () => {
		const first = Buffer.from("zenos entry one");
		const second = Buffer.from("two");
		const archive = buildZenos(
			[
				{ name: "a.bin", content: first },
				{ name: "b.txt", content: second },
			],
			"ZENOSK",
		);
		await expectArchive({
			format: rpmZenosFormat,
			archive,
			sourcePath: "sample.dat",
			entries: [
				{ path: "a.bin", size: first.length, content: first },
				{ path: "b.txt", size: second.length, content: second },
			],
			metadata: {
				entryCount: 2,
				keyword: "ZENOSK",
				nameLength: NAME_SIZE,
				compressed: true,
			},
		});
	});

	it("is not claimed by the RPM ARC opener that shares its index layout", async () => {
		const archive = buildZenos(
			[{ name: "a.bin", content: Buffer.from("payload") }],
			"ZENOSK",
		);
		const source = new BufferByteSource(archive);
		expect(await rpmZenosFormat.detect(source, "sample.dat")).toBe(true);
		// The 0x10-byte record width makes the index end at a different offset than the RPM
		// opener derives from its 0x20-byte candidate, so the bytes must not be claimed twice.
		expect(await rpmArcFormat.detect(source, "sample.arc")).toBe(false);
	});

	it("ignores unrelated data", async () => {
		await expectArchive({
			format: rpmZenosFormat,
			archive: Buffer.alloc(0x40, 0x41),
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});
});
