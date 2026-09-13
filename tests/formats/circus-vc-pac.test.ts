import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { circusVcPacFormat } from "../../packages/formats/src/circus/vc.js";

const RECORD_SIZE = 0x38;
const INDEX_OFFSET = 0x20;

interface PacFixtureEntry {
	name: string;
	data: Buffer;
}

/**
 * Builds a Valkyrie Complex PAC archive: a version word, the count, the base offset of the payload
 * area, the file size, and a fixed size record per entry.
 */
function buildPac(
	entries: PacFixtureEntry[],
	options: { baseOffset?: number; fileSize?: number; count?: number } = {},
): Buffer {
	const indexSize = entries.length * RECORD_SIZE;
	const baseOffset = options.baseOffset ?? INDEX_OFFSET + indexSize;
	const total =
		baseOffset + entries.reduce((sum, entry) => sum + entry.data.length, 0);
	const file = Buffer.alloc(options.fileSize ?? total);
	file.writeUInt32LE(1, 0);
	file.writeInt32LE(options.count ?? entries.length, 4);
	file.writeUInt32LE(baseOffset, 8);
	file.writeUInt32LE(total, 0xc);
	let offset = baseOffset;
	for (const [index, entry] of entries.entries()) {
		const position = INDEX_OFFSET + index * RECORD_SIZE;
		file.write(entry.name, position, "latin1");
		file.writeUInt32LE(entry.data.length, position + 0x20);
		// Stored offsets are relative to the base offset.
		file.writeUInt32LE(offset - baseOffset, position + 0x24);
		entry.data.copy(file, offset);
		offset += entry.data.length;
	}
	return file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("valkyrie complex pac", () => {
	it("declares the version word as its signature", () => {
		expect(circusVcPacFormat.detection?.signatures?.[0]?.bytes).toEqual(
			Buffer.from([1, 0, 0, 0]),
		);
	});

	it("declines a file whose size word does not match", async () => {
		const file = buildPac([{ name: "a.bin", data: Buffer.from("body") }], {
			fileSize: 0x100,
		});
		expect(await circusVcPacFormat.detect(sourceOf(file))).toBe(false);
	});

	it("declines an insane entry count", async () => {
		const file = buildPac([{ name: "a.bin", data: Buffer.from("body") }], {
			count: 0x80000,
		});
		expect(await circusVcPacFormat.detect(sourceOf(file))).toBe(false);
	});

	it("declines a base offset behind the file", async () => {
		const file = buildPac([{ name: "a.bin", data: Buffer.from("body") }]);
		// The base offset has to stay in front of the file size.
		file.writeUInt32LE(file.length, 8);
		expect(await circusVcPacFormat.detect(sourceOf(file))).toBe(false);
	});

	it("declines an entry that leaves the archive", async () => {
		const file = buildPac([{ name: "a.bin", data: Buffer.from("body") }]);
		file.writeUInt32LE(0x1000, INDEX_OFFSET + 0x20);
		expect(await circusVcPacFormat.detect(sourceOf(file))).toBe(false);
	});

	it("lists and extracts entries", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from([9, 8, 7]);
		const file = buildPac([
			{ name: "DATA.BIN", data: first },
			{ name: "SUB/OTHER.DAT", data: second },
		]);
		const source = sourceOf(file);
		expect(await circusVcPacFormat.detect(source)).toBe(true);
		const archive = await circusVcPacFormat.open(source, "GAME.PAC");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"DATA.BIN",
				"SUB/OTHER.DAT",
			]);
			expect(archive.entries.map((entry) => Number(entry.size))).toEqual([
				first.length,
				second.length,
			]);
			expect(archive.metadata).toMatchObject({ entryCount: 2 });
			const entry = archive.entries[1];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				second,
			);
		} finally {
			await archive.close();
		}
	});

	it("applies the base offset to stored offsets", async () => {
		const data = Buffer.from("base offset payload");
		const file = buildPac([{ name: "B.BIN", data }]);
		const baseOffset = file.readUInt32LE(8);
		// Stored offsets are relative to the base offset, so the first payload sits right after it.
		expect(file.readUInt32LE(INDEX_OFFSET + 0x24)).toBe(0);
		expect(baseOffset).toBeGreaterThan(INDEX_OFFSET);
		const archive = await circusVcPacFormat.open(sourceOf(file), "GAME.PAC");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				data,
			);
		} finally {
			await archive.close();
		}
	});

	it("keeps a name that fills its whole field", async () => {
		const file = buildPac([
			{ name: "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456", data: Buffer.from("x") },
		]);
		const archive = await circusVcPacFormat.open(sourceOf(file), "GAME.PAC");
		try {
			expect(archive.entries[0]?.path).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
		} finally {
			await archive.close();
		}
	});
});
