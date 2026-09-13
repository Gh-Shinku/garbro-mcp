import { encodeCp932 } from "@garbro-mcp/core";
import { rpmArcFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";
import { describe, it } from "vitest";

const NAME_SIZE = 0x20;
const INDEX_OFFSET = 8;

interface FixtureEntry {
	name: string;
	stored: Buffer;
	unpacked?: Buffer;
	/** Overrides the recorded data offset, to exercise placement rejection. */
	offset?: number;
}

/**
 * Mirrors GARbro `ArcIndexReader.DecryptIndex`, which adds the keyword to the stored index, so a
 * fixture encrypts by subtracting it.
 */
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

function buildRpmArc(
	entries: readonly FixtureEntry[],
	keyword: string,
	options: { nameSize?: number; compressed?: boolean } = {},
): Buffer {
	const nameSize = options.nameSize ?? NAME_SIZE;
	const count = entries.length;
	const indexSize = count * (nameSize + 12);
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.stored.length, 0),
	);
	archive.writeInt32LE(count, 0);
	archive.writeUInt32LE(options.compressed === true ? 1 : 0, 4);
	const index = Buffer.alloc(indexSize);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = id * (nameSize + 12);
		encodeCp932(entry.name).copy(index, record);
		index.writeUInt32LE(
			entry.unpacked?.length ?? entry.stored.length,
			record + nameSize,
		);
		index.writeUInt32LE(entry.stored.length, record + nameSize + 4);
		index.writeUInt32LE(entry.offset ?? offset, record + nameSize + 8);
		offset += entry.stored.length;
		entry.stored.copy(archive, position);
		position += entry.stored.length;
	}
	encryptIndex(index, keyword).copy(archive, INDEX_OFFSET);
	return archive;
}

describe("RPM ARC archive", () => {
	it("reads an uncompressed index with a guessed keyword", async () => {
		const archive = buildRpmArc(
			[
				{ name: "data/one.bin", stored: Buffer.from("first") },
				{ name: "two.txt", stored: Buffer.from("second!") },
			],
			"RPMKEY",
		);
		await expectArchive({
			format: rpmArcFormat,
			archive,
			sourcePath: "sample.arc",
			entries: [
				{ path: "data/one.bin", size: 5, content: Buffer.from("first") },
				{ path: "two.txt", size: 7, content: Buffer.from("second!") },
			],
			metadata: {
				entryCount: 2,
				keyword: "RPMKEY",
				nameLength: NAME_SIZE,
				compressed: false,
			},
		});
	});

	it("falls back to the 0x18-byte name field", async () => {
		// GARbro probes with the widest candidate first, so the payload must cover a 0x20 probe.
		const payload = Buffer.from("long enough payload");
		const archive = buildRpmArc(
			[{ name: "short.bin", stored: payload }],
			"RPMKEY",
			{ nameSize: 0x18 },
		);
		await expectArchive({
			format: rpmArcFormat,
			archive,
			sourcePath: "sample.arc",
			entries: [{ path: "short.bin", size: payload.length, content: payload }],
			metadata: { keyword: "RPMKEY", nameLength: 0x18, compressed: false },
		});
	});

	it("decompresses LZSS entries and reports the unpacked size", async () => {
		const text = Buffer.from("hello rpm world!");
		const archive = buildRpmArc(
			[{ name: "a.bin", stored: literalLzssStream(text), unpacked: text }],
			"RPMKEY",
			{ compressed: true },
		);
		await expectArchive({
			format: rpmArcFormat,
			archive,
			sourcePath: "sample.arc",
			entries: [{ path: "a.bin", size: text.length, content: text }],
			metadata: { compressed: true },
		});
	});

	it("forces the 'inst' keyword for instdata.arc", async () => {
		const archive = buildRpmArc(
			[{ name: "entry.bin", stored: Buffer.from("inst") }],
			"OTHER",
		);
		// The guessed keyword is replaced by 'inst' for this specific file name, so the archive
		// can only be read when the stored keyword already is 'inst'.
		await expectArchive({
			format: rpmArcFormat,
			archive,
			sourcePath: "/games/instdata.arc",
			detected: false,
			entries: [],
		});
		await expectArchive({
			format: rpmArcFormat,
			archive,
			sourcePath: "/games/other.arc",
			entries: [{ path: "entry.bin", size: 4, content: Buffer.from("inst") }],
			metadata: { keyword: "OTHER" },
		});
	});

	it("rejects entries placed outside the archive", async () => {
		const archive = buildRpmArc(
			[
				{ name: "ok.bin", stored: Buffer.from("ok") },
				{ name: "bad.bin", stored: Buffer.from("bad"), offset: 1 << 20 },
			],
			"RPMKEY",
		);
		await expectArchive({
			format: rpmArcFormat,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});

	it("ignores unrelated data", async () => {
		const archive = Buffer.from("this is not an RPM archive at all");
		await expectArchive({
			format: rpmArcFormat,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});
});
