import { encodeCp932 } from "@garbro-mcp/core";
import { lunaPacFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const SIGNATURE = Buffer.from([0x82, 0xcf, 0x82, 0xad]);
const INDEX_OFFSET = 0x10;

interface Entry {
	name: string;
	content: Buffer;
}

/** Builds a PAC archive in either the 32-bit or the 64-bit offset layout. */
function buildPac(
	entries: readonly Entry[],
	longOffsets: boolean,
	baseOffset = 0,
): Buffer {
	const sizePosition = longOffsets ? 0x108 : 0x104;
	const recordLength = sizePosition + 8;
	const indexSize = recordLength * entries.length;
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, e) => sum + e.content.length, 0),
	);
	SIGNATURE.copy(archive, 0);
	archive.writeInt32LE(entries.length, 4);
	archive.writeUInt32LE(baseOffset, 8);
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * recordLength;
		const encoded = encodeCp932(entry.name);
		encoded.copy(archive, record);
		archive.writeUInt32LE(encoded.length, record + sizePosition + 4);
		const relative = position - baseOffset;
		if (longOffsets) archive.writeBigInt64LE(BigInt(relative), record + 0x100);
		else archive.writeUInt32LE(relative, record + 0x100);
		archive.writeUInt32LE(entry.content.length, record + sizePosition);
		entry.content.copy(archive, position);
		position += entry.content.length;
	}
	return archive;
}

describe("LunaSoft PAC archive", () => {
	it("reads the 32-bit offset layout", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second");
		await expectArchive({
			format: lunaPacFormat,
			archive: buildPac(
				[
					{ name: "one.dat", content: first },
					{ name: "two.dat", content: second },
				],
				false,
			),
			sourcePath: "sample.pac",
			entries: [
				{ path: "one.dat", size: first.length, content: first },
				{ path: "two.dat", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("falls back to the 64-bit offset layout", async () => {
		// A payload above 0x100 bytes makes the 32-bit probe read an out-of-range name length, which is
		// what GARbro relies on to reach the wider layout.
		const content = Buffer.alloc(0x200, 0x5a);
		await expectArchive({
			format: lunaPacFormat,
			archive: buildPac([{ name: "wide.dat", content }], true),
			sourcePath: "sample.pac",
			entries: [{ path: "wide.dat", size: content.length, content }],
		});
	});

	it("applies the base offset", async () => {
		const content = Buffer.from("based");
		// Offsets are stored relative to the base word at 8, so a base equal to the data start leaves
		// a zero relative offset in the record.
		const archive = buildPac(
			[{ name: "based.dat", content }],
			false,
			INDEX_OFFSET + 0x10c,
		);
		await expectArchive({
			format: lunaPacFormat,
			archive,
			sourcePath: "sample.pac",
			entries: [{ path: "based.dat", size: content.length, content }],
		});
	});

	it("rejects an out-of-range name length", async () => {
		const archive = buildPac(
			[{ name: "a.dat", content: Buffer.from("x") }],
			false,
		);
		archive.writeUInt32LE(0x200, INDEX_OFFSET + 0x104 + 4);
		await expectArchive({
			format: lunaPacFormat,
			archive,
			sourcePath: "sample.pac",
			detected: false,
			entries: [],
		});
	});
});
