import { BufferByteSource } from "@garbro-mcp/core";
import { clickTeamMfsFormat } from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const MFS_SIGNATURE = Buffer.from([
	0x77, 0x77, 0x77, 0x77, 0x49, 0x87, 0x47, 0x12,
]);
const INDEX_START = 0x20;

interface Record {
	name: string;
	content: Buffer;
	/** Store the payload raw instead of deflating it. */
	stored?: boolean;
}

interface BuiltMfs {
	archive: Buffer;
	/** Stored — not unpacked — sizes, which is what the index declares. */
	storedSizes: number[];
}

/** Records are a code-unit name length, the UTF-16 name, two reserved words, the size and the payload. */
function buildIndex(records: readonly Record[]): BuiltMfs {
	const parts: Buffer[] = [];
	const storedSizes: number[] = [];
	for (const record of records) {
		const name = Buffer.from(record.name, "utf16le");
		const nameLength = Buffer.alloc(2);
		nameLength.writeUInt16LE(name.length / 2, 0);
		const payload = record.stored
			? record.content
			: deflateSync(record.content);
		const size = Buffer.alloc(4);
		size.writeUInt32LE(payload.length, 0);
		parts.push(nameLength, name, Buffer.alloc(4), size, payload);
		storedSizes.push(payload.length);
	}
	const header = Buffer.alloc(INDEX_START);
	MFS_SIGNATURE.copy(header, 0);
	header.writeInt32LE(records.length, 0x1c);
	return { archive: Buffer.concat([header, ...parts]), storedSizes };
}

/** Wraps an archive in a minimal PE image whose single section ends at 0x300. */
function wrapInExecutable(payload: Buffer): Buffer {
	const stub = Buffer.alloc(0x300);
	stub.write("MZ", 0, "ascii");
	stub.writeUInt32LE(0x40, 0x3c);
	stub.write("PE\0\0", 0x40, "binary");
	stub.writeUInt16LE(1, 0x40 + 6);
	stub.writeUInt16LE(0xe0, 0x40 + 0x14);
	// SizeOfHeaders lives at the start of the optional header plus 0x3C.
	stub.writeUInt32LE(0x200, 0x40 + 0x18 + 0x3c);
	const section = 0x40 + 0xe0 + 0x18;
	stub.writeUInt32LE(0x100, section + 0x10);
	stub.writeUInt32LE(0x200, section + 0x14);
	return Buffer.concat([stub, payload]);
}

describe("ClickTeam MFS resource archive", () => {
	it("reads the payload table and deflates entries", async () => {
		const script = Buffer.from("multimedia fusion script");
		const library = Buffer.from("dll payload");
		const { archive, storedSizes } = buildIndex([
			{ name: "script.mfx", content: script },
			{ name: "mmfs2.dll", content: library, stored: true },
		]);
		await expectArchive({
			format: clickTeamMfsFormat,
			archive,
			entries: [
				{ path: "script.mfx", size: storedSizes[0] ?? 0, content: script },
				{
					path: "mmfs2.dll",
					size: storedSizes[1] ?? 0,
					content: library,
				},
			],
		});
	});

	it("finds the archive behind an executable overlay", async () => {
		const content = Buffer.from("overlay payload");
		const { archive, storedSizes } = buildIndex([
			{ name: "data.bin", content },
		]);
		await expectArchive({
			format: clickTeamMfsFormat,
			archive: wrapInExecutable(archive),
			entries: [{ path: "data.bin", size: storedSizes[0] ?? 0, content }],
		});
	});

	it("rejects a plain file without the marker", async () => {
		const { archive } = buildIndex([
			{ name: "a.bin", content: Buffer.alloc(4) },
		]);
		archive.fill(0, 0, MFS_SIGNATURE.length);
		const source = new BufferByteSource(archive);
		expect(await clickTeamMfsFormat.detect(source)).toBe(false);
	});

	it("rejects a record whose payload falls outside the archive", async () => {
		const { archive } = buildIndex([
			{ name: "a.bin", content: Buffer.alloc(4) },
		]);
		const sizeOffset = INDEX_START + 2 + "a.bin".length * 2 + 4;
		archive.writeUInt32LE(0x1000, sizeOffset);
		const source = new BufferByteSource(archive);
		expect(await clickTeamMfsFormat.detect(source)).toBe(false);
	});

	it("rejects an executable without a valid overlay", async () => {
		const { archive } = buildIndex([
			{ name: "a.bin", content: Buffer.alloc(4) },
		]);
		const wrapped = wrapInExecutable(archive);
		wrapped.writeUInt32LE(wrapped.length - 4, 0x3c);
		const source = new BufferByteSource(wrapped);
		expect(await clickTeamMfsFormat.detect(source)).toBe(false);
	});
});
