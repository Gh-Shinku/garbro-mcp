import { encodeCp932 } from "@garbro-mcp/core";
import { xpkFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const SIGNATURE = Buffer.from("XPK1\x1a", "latin1");

interface XpkEntry {
	name: string;
	content: Buffer;
	unpackedSize?: number;
}

/** Writes a GARbro `ReadUInt`: a leading 0x04 size byte plus a big-endian 32-bit value. */
function writeUInt(archive: Buffer, position: number, value: number): number {
	archive.writeUInt8(4, position);
	archive.writeUInt32BE(value >>> 0, position + 1);
	return position + 5;
}

function buildXpk(entries: readonly XpkEntry[]): Buffer {
	const indexSize = entries.reduce(
		(sum, entry) => sum + 18 + encodeCp932(entry.name).length,
		0,
	);
	const dataOffset = 10 + 5 + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	SIGNATURE.copy(archive, 0);
	let position = writeUInt(archive, 10, entries.length);
	let offset = dataOffset;
	let dataPosition = dataOffset;
	for (const entry of entries) {
		position = writeUInt(archive, position, offset);
		position = writeUInt(archive, position, entry.content.length);
		position = writeUInt(
			archive,
			position,
			entry.unpackedSize ?? entry.content.length,
		);
		position += 2;
		const name = encodeCp932(entry.name);
		name.copy(archive, position);
		position += name.length + 1;
		entry.content.copy(archive, dataPosition);
		dataPosition += entry.content.length;
		offset += entry.content.length;
	}
	return archive;
}

describe("KAG System XPK archive", () => {
	it("reads big-endian varints and null-terminated names", async () => {
		await expectArchive({
			format: xpkFormat,
			archive: buildXpk([
				{ name: "data/scene.ks", content: Buffer.from("script") },
				{ name: "画像/bg.bmp", content: Buffer.from("bitmap") },
			]),
			sourcePath: "data.xpk",
			entries: [
				{ path: "data/scene.ks", size: 6, content: Buffer.from("script") },
				{ path: "画像/bg.bmp", size: 6, content: Buffer.from("bitmap") },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("accepts a zero-length entry at the end of the file", async () => {
		const archive = buildXpk([{ name: "empty.ks", content: Buffer.alloc(0) }]);
		await expectArchive({
			format: xpkFormat,
			archive,
			sourcePath: "data.xpk",
			entries: [{ path: "empty.ks", size: 0, content: Buffer.alloc(0) }],
		});
	});

	it("rejects an index whose varints are not size-prefixed", async () => {
		const archive = buildXpk([{ name: "a.ks", content: Buffer.from("a") }]);
		archive.writeUInt8(0, 10);
		await expectArchive({
			format: xpkFormat,
			archive,
			sourcePath: "data.xpk",
			detected: false,
			entries: [],
		});
	});

	it("rejects entries placed outside the archive", async () => {
		const archive = buildXpk([{ name: "a.ks", content: Buffer.from("a") }]);
		archive.writeUInt32BE(0x100000, 16);
		await expectArchive({
			format: xpkFormat,
			archive,
			sourcePath: "data.xpk",
			detected: false,
			entries: [],
		});
	});
});
