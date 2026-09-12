import { crc32 } from "@garbro-mcp/codecs";
import { encodeCp932 } from "@garbro-mcp/core";
import { zipFormat } from "@garbro-mcp/formats";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

interface ZipFixtureEntry {
	name: string;
	content: Buffer;
	deflate?: boolean;
	utf8?: boolean;
	cp932?: boolean;
	encrypted?: boolean;
}

function toName(entry: ZipFixtureEntry): Buffer {
	if (entry.cp932) return encodeCp932(entry.name);
	return Buffer.from(entry.name, entry.utf8 ? "utf8" : "latin1");
}

function buildZip(entries: ZipFixtureEntry[]): Buffer {
	const chunks: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	for (const entry of entries) {
		const name = toName(entry);
		const compressed = entry.deflate
			? deflateRawSync(entry.content)
			: entry.content;
		const method = entry.deflate ? 8 : 0;
		const flags = (entry.utf8 ? 0x0800 : 0) | (entry.encrypted ? 0x0001 : 0);
		const crc = crc32(entry.content);
		const local = Buffer.alloc(30);
		local.write("PK\u0003\u0004", 0, "binary");
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(flags, 6);
		local.writeUInt16LE(method, 8);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(entry.content.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		chunks.push(local, name, compressed);

		const record = Buffer.alloc(46);
		record.write("PK\u0001\u0002", 0, "binary");
		record.writeUInt16LE(20, 4);
		record.writeUInt16LE(20, 6);
		record.writeUInt16LE(flags, 8);
		record.writeUInt16LE(method, 10);
		record.writeUInt32LE(crc, 16);
		record.writeUInt32LE(compressed.length, 20);
		record.writeUInt32LE(entry.content.length, 24);
		record.writeUInt16LE(name.length, 28);
		record.writeUInt32LE(offset, 42);
		central.push(record, name);
		offset += local.length + name.length + compressed.length;
	}
	const directory = Buffer.concat(central);
	chunks.push(directory);
	const eocd = Buffer.alloc(22);
	eocd.write("PK\u0005\u0006", 0, "binary");
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(directory.length, 12);
	eocd.writeUInt32LE(offset, 16);
	chunks.push(eocd);
	return Buffer.concat(chunks);
}

describe("PKWARE ZIP archive", () => {
	it("reads stored and deflated entries and skips directory records", async () => {
		const stored = Buffer.from("stored payload");
		const deflated = Buffer.from("deflated payload");
		const archive = buildZip([
			{ name: "dir/", content: Buffer.alloc(0) },
			{ name: "stored.bin", content: stored },
			{ name: "deflated.bin", content: deflated, deflate: true },
		]);
		const format = zipFormat;
		const source = new BufferByteSource(archive);
		expect(await format.detect(source, "data.zip")).toBe(true);
		const handle = await format.open(source, "data.zip");
		try {
			expect(handle.entries.map((entry) => entry.path)).toEqual([
				"stored.bin",
				"deflated.bin",
			]);
			expect(handle.entries[1]).toMatchObject({
				compressed: true,
				size: BigInt(deflated.length),
			});
			expect(await consumeBuffer(await handle.openEntry("0"))).toEqual(stored);
			expect(await consumeBuffer(await handle.openEntry("1"))).toEqual(
				deflated,
			);
		} finally {
			await handle.close();
		}
	});

	it("decodes CP932 names by default and UTF-8 names when flagged", async () => {
		const archive = buildZip([
			{ name: "画像.bmp", content: Buffer.from("a"), cp932: true },
			{ name: "дата.bin", content: Buffer.from("b"), utf8: true },
		]);
		const handle = await zipFormat.open(
			new BufferByteSource(archive),
			"data.zip",
		);
		try {
			expect(handle.entries.map((entry) => entry.path)).toEqual([
				"画像.bmp",
				"дата.bin",
			]);
		} finally {
			await handle.close();
		}
	});

	it("reports encrypted entries as unsupported", async () => {
		const archive = buildZip([
			{ name: "a.bin", content: Buffer.from("a"), encrypted: true },
		]);
		const handle = await zipFormat.open(
			new BufferByteSource(archive),
			"data.zip",
		);
		try {
			await expect(handle.openEntry("0")).rejects.toThrow(
				/encrypted|UNSUPPORTED/,
			);
		} finally {
			await handle.close();
		}
	});

	it("rejects a buffer without an end-of-central-directory record", async () => {
		expect(
			await zipFormat.detect(
				new BufferByteSource(Buffer.from("not a zip archive")),
			),
		).toBe(false);
	});
});
