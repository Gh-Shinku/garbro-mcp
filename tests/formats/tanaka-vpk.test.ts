import { encodeCp932 } from "@garbro-mcp/core";
import { tanakaVpkFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x20;

interface VpkEntry {
	stem: string;
	n1: number;
	n2: number;
	n3?: number;
	content: Buffer;
}

function buildVpk(entries: readonly VpkEntry[], version: number): Buffer {
	const nameLength = version > 0 ? 4 : 2;
	const recordSize = version > 0 ? 20 : 16;
	const indexSize = entries.length * (nameLength + recordSize);
	const dataOffset = INDEX_OFFSET + indexSize;
	const data = Buffer.concat(entries.map((entry) => entry.content));
	const archive = Buffer.concat([Buffer.alloc(dataOffset), data]);
	archive.write(version > 0 ? "VPK1" : "VPK0", 0, "ascii");
	// GARbro requires data_size + index_size to equal the file size, so the stored data size covers
	// the 0x20-byte header as well.
	archive.writeUInt32LE(INDEX_OFFSET + data.length, 4);
	archive.writeInt32LE(entries.length, 8);
	archive.writeUInt32LE(indexSize, 0x0c);
	let position = INDEX_OFFSET;
	let offset = dataOffset;
	for (const entry of entries) {
		encodeCp932(entry.stem).copy(archive, position);
		position += nameLength;
		archive.writeUInt16LE(entry.n1, position);
		if (version > 0) {
			archive.writeUInt16LE(entry.n2, position + 2);
			archive.writeUInt32LE(entry.n3 ?? 0, position + 4);
			archive.writeUInt32LE(offset, position + 8);
			archive.writeUInt32LE(entry.content.length, position + 12);
		} else {
			archive.writeUInt32LE(entry.n2, position + 2);
			archive.writeUInt32LE(offset, position + 6);
			archive.writeUInt32LE(entry.content.length, position + 10);
		}
		position += recordSize;
		offset += entry.content.length;
	}
	return archive;
}

describe("Tanaka VPK audio archive", () => {
	it("composes version 1 names from four numeric fields", async () => {
		const first = Buffer.from("RIFF v1 first");
		const second = Buffer.from("RIFF v1 second");
		await expectArchive({
			format: tanakaVpkFormat,
			archive: buildVpk(
				[
					{ stem: "bgm", n1: 3, n2: 7, n3: 42, content: first },
					{ stem: "se", n1: 0, n2: 0, n3: 5, content: second },
				],
				1,
			),
			sourcePath: "sound.vpk",
			entries: [
				{ path: "bgm_03_7_042.wav", size: first.length, content: first },
				{ path: "se_00_0_005.wav", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("composes version 0 names from three numeric fields", async () => {
		const content = Buffer.from("RIFF v0");
		await expectArchive({
			format: tanakaVpkFormat,
			// The version 0 name field is only two bytes wide, so the stem is truncated.
			archive: buildVpk([{ stem: "vo", n1: 12, n2: 345, content }], 0),
			sourcePath: "sound.vpk",
			entries: [{ path: "vo_12_345.wav", size: content.length, content }],
		});
	});

	it("rejects a size mismatch between header and file", async () => {
		const archive = buildVpk(
			[{ stem: "se", n1: 1, n2: 1, n3: 1, content: Buffer.from("x") }],
			1,
		);
		archive.writeUInt32LE(0x1000, 4);
		await expectArchive({
			format: tanakaVpkFormat,
			archive,
			sourcePath: "sound.vpk",
			detected: false,
			entries: [],
		});
	});
});
