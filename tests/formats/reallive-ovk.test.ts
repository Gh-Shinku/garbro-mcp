import { ovkFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

interface OvkEntry {
	id: number;
	content: Buffer;
}

function buildOvk(
	entries: readonly OvkEntry[],
	variant: "ovk" | "nwk",
): Buffer {
	const entrySize = variant === "ovk" ? 0x10 : 0x0c;
	const dataOffset = 4 + entries.length * entrySize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeInt32LE(entries.length, 0);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = 4 + index * entrySize;
		archive.writeUInt32LE(entry.content.length, record);
		archive.writeUInt32LE(offset, record + 4);
		archive.writeUInt32LE(entry.id, record + 8);
		offset += entry.content.length;
		entry.content.copy(archive, position);
		position += entry.content.length;
	}
	return archive;
}

describe("RealLive OVK archive", () => {
	it("reads 0x10-byte records with .ogg names", async () => {
		await expectArchive({
			format: ovkFormat,
			archive: buildOvk(
				[
					{ id: 0, content: Buffer.from("OggS first") },
					{ id: 7, content: Buffer.from("OggS second") },
				],
				"ovk",
			),
			sourcePath: "bgm.ovk",
			entries: [
				{ path: "bgm#00000.ogg", size: 10, content: Buffer.from("OggS first") },
				{
					path: "bgm#00007.ogg",
					size: 11,
					content: Buffer.from("OggS second"),
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("reads 0x0c-byte records with .nwa names", async () => {
		const content = Buffer.from("nwa payload");
		await expectArchive({
			format: ovkFormat,
			archive: buildOvk([{ id: 3, content }], "nwk"),
			sourcePath: "/games/se.nwk",
			entries: [{ path: "se#00003.nwa", size: content.length, content }],
		});
	});

	it("requires a known extension", async () => {
		await expectArchive({
			format: ovkFormat,
			archive: buildOvk([{ id: 0, content: Buffer.from("x") }], "ovk"),
			sourcePath: "bgm.dat",
			detected: false,
			entries: [],
		});
	});

	it("rejects payloads that overlap the index", async () => {
		const archive = buildOvk([{ id: 0, content: Buffer.from("x") }], "ovk");
		archive.writeUInt32LE(0, 8);
		await expectArchive({
			format: ovkFormat,
			archive,
			sourcePath: "bgm.ovk",
			detected: false,
			entries: [],
		});
	});
});
