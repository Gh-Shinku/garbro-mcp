import { BufferByteSource } from "@garbro-mcp/core";
import { yaneuraoDatDxFormat, yaneuraoDatExFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const DX_STRIDE = 0x10c;
const DX_NAME_SIZE = 0x100;
const EX_STRIDE = 0x2c;
const EX_NAME_SIZE = 0x20;

interface FixtureEntry {
	name: string;
	data: Buffer;
	/** Declared unpacked size; defaults to the stored length. */
	unpackedSize?: number;
}

/**
 * Builds a `yanepkDx` archive. The count is not stored: it is derived from the first entry's payload
 * offset, which sits at 0x10C and equals the end of the table, so the fixture keeps payloads
 * contiguous right after the table.
 */
function buildDx(
	entries: readonly FixtureEntry[],
	marker: "marker" | "yane" = "marker",
): Buffer {
	const tableSize = entries.length * DX_STRIDE;
	const payloadBase = 0xc + tableSize;
	const table = Buffer.alloc(tableSize);
	const payloads: Buffer[] = [];
	let payloadOffset = payloadBase;
	for (const [id, entry] of entries.entries()) {
		const record = id * DX_STRIDE;
		table.write(entry.name, record, "latin1");
		table.writeUInt32LE(payloadOffset, record + DX_NAME_SIZE);
		table.writeUInt32LE(
			entry.unpackedSize ?? entry.data.length,
			record + DX_NAME_SIZE + 4,
		);
		table.writeUInt32LE(entry.data.length, record + DX_NAME_SIZE + 8);
		payloads.push(entry.data);
		payloadOffset += entry.data.length;
	}
	const header = Buffer.alloc(0xc);
	if (marker === "yane") header.write("yanepkDx", 0, "ascii");
	else header.writeUInt32LE(0x0c09140a, 0);
	return Buffer.concat([header, table, ...payloads]);
}

/** Builds a `yanepkEx` archive: a count at 0x08 and 0x20-byte names. */
function buildEx(entries: readonly FixtureEntry[]): Buffer {
	const tableSize = entries.length * EX_STRIDE;
	const entryCount = Buffer.alloc(4);
	entryCount.writeInt32LE(entries.length, 0);
	const payloadBase = 0xc + tableSize;
	const table = Buffer.alloc(tableSize);
	const payloads: Buffer[] = [];
	let payloadOffset = payloadBase;
	for (const [id, entry] of entries.entries()) {
		const record = id * EX_STRIDE;
		table.write(entry.name, record, "latin1");
		table.writeUInt32LE(payloadOffset, record + EX_NAME_SIZE);
		table.writeUInt32LE(
			entry.unpackedSize ?? entry.data.length,
			record + EX_NAME_SIZE + 4,
		);
		table.writeUInt32LE(entry.data.length, record + EX_NAME_SIZE + 8);
		payloads.push(entry.data);
		payloadOffset += entry.data.length;
	}
	return Buffer.concat([
		Buffer.from("yanepkEx", "ascii"),
		entryCount,
		table,
		...payloads,
	]);
}

describe("Yaneurao DAT resource archives", () => {
	it("lists and extracts yanepkDx entries", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload, longer");
		await expectArchive({
			format: yaneuraoDatDxFormat,
			archive: buildDx([
				{ name: "FIRST.BIN", data: first },
				{ name: "SECOND.BIN", data: second },
			]),
			entries: [
				{ path: "FIRST.BIN", size: first.length, content: first },
				{ path: "SECOND.BIN", size: second.length, content: second },
			],
		});
	});

	it("accepts the yane pkDx marker", async () => {
		const data = Buffer.from("payload");
		await expectArchive({
			format: yaneuraoDatDxFormat,
			archive: buildDx([{ name: "FILE.BIN", data }], "yane"),
			entries: [{ path: "FILE.BIN", size: data.length, content: data }],
		});
	});

	it("unpacks yanepkDx entries whose sizes differ", async () => {
		const unpacked = Buffer.from("unpacked bytes");
		const stored = literalLzssStream(unpacked);
		await expectArchive({
			format: yaneuraoDatDxFormat,
			archive: buildDx([
				{ name: "PACKED.BIN", data: stored, unpackedSize: unpacked.length },
			]),
			entries: [
				{ path: "PACKED.BIN", size: unpacked.length, content: unpacked },
			],
		});
	});

	it("truncates a table that does not fill the gap before the payload", async () => {
		const data = Buffer.from("payload");
		// The gap is 0x100 bytes short of a full stride, so the reference's division still yields one.
		const payloadOffset = 0x118 + 0x100;
		const archive = Buffer.alloc(payloadOffset + data.length);
		archive.writeUInt32LE(0x0c09140a, 0);
		archive.write("FILE.BIN", 0xc, "latin1");
		archive.writeUInt32LE(payloadOffset, 0xc + DX_NAME_SIZE);
		archive.writeUInt32LE(data.length, 0xc + DX_NAME_SIZE + 4);
		archive.writeUInt32LE(data.length, 0xc + DX_NAME_SIZE + 8);
		data.copy(archive, payloadOffset);
		await expectArchive({
			format: yaneuraoDatDxFormat,
			archive,
			entries: [{ path: "FILE.BIN", size: data.length, content: data }],
		});
	});

	it("reads a directory-like name through path normalization", async () => {
		const data = Buffer.from("nested");
		await expectArchive({
			format: yaneuraoDatDxFormat,
			archive: buildDx([{ name: "DIR\\FILE.BIN", data }]),
			entries: [{ path: "DIR/FILE.BIN", size: data.length, content: data }],
		});
	});

	it("rejects a yanepkDx table with an out-of-range payload", async () => {
		const archive = buildDx([
			{ name: "FIRST.BIN", data: Buffer.from("x") },
			{ name: "SECOND.BIN", data: Buffer.from("y") },
		]);
		// The second record's payload offset field sits one stride behind the first one's.
		archive.writeUInt32LE(0x1000, 0x10c + DX_STRIDE);
		const source = new BufferByteSource(archive);
		expect(await yaneuraoDatDxFormat.detect(source)).toBe(false);
	});

	it("rejects a yanepkDx payload offset below the first record", async () => {
		const archive = buildDx([{ name: "FILE.BIN", data: Buffer.from("x") }]);
		archive.writeUInt32LE(0x100, 0x10c);
		const source = new BufferByteSource(archive);
		expect(await yaneuraoDatDxFormat.detect(source)).toBe(false);
	});

	it("lists and extracts yanepkEx entries with the inherited opener", async () => {
		const stored = Buffer.from("plain");
		const unpacked = Buffer.from("unpacked ex");
		const stream = literalLzssStream(unpacked);
		await expectArchive({
			format: yaneuraoDatExFormat,
			archive: buildEx([
				{ name: "PLAIN.BIN", data: stored },
				{ name: "PACKED.BIN", data: stream, unpackedSize: unpacked.length },
			]),
			entries: [
				{ path: "PLAIN.BIN", size: stored.length, content: stored },
				{ path: "PACKED.BIN", size: unpacked.length, content: unpacked },
			],
		});
	});

	it("rejects an unsane yanepkEx count", async () => {
		const archive = buildEx([{ name: "FILE.BIN", data: Buffer.from("x") }]);
		archive.writeInt32LE(0, 8);
		const source = new BufferByteSource(archive);
		expect(await yaneuraoDatExFormat.detect(source)).toBe(false);
	});

	it("rejects a truncated yanepkEx table", async () => {
		const archive = buildEx([
			{ name: "FILE.BIN", data: Buffer.from("x") },
		]).subarray(0, 0xc + EX_STRIDE - 1);
		const source = new BufferByteSource(archive);
		expect(await yaneuraoDatExFormat.detect(source)).toBe(false);
	});

	it("keeps the two variants apart", async () => {
		const data = Buffer.from("payload");
		const dxSource = new BufferByteSource(
			buildDx([{ name: "F.BIN", data }], "yane"),
		);
		expect(await yaneuraoDatDxFormat.detect(dxSource)).toBe(true);
		expect(await yaneuraoDatExFormat.detect(dxSource)).toBe(false);

		const exSource = new BufferByteSource(buildEx([{ name: "F.BIN", data }]));
		expect(await yaneuraoDatExFormat.detect(exSource)).toBe(true);
		expect(await yaneuraoDatDxFormat.detect(exSource)).toBe(false);
	});
});
