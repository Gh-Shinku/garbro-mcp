import { BufferByteSource } from "@garbro-mcp/core";
import { tmrHiroPacFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_START = 7;

interface Entry {
	name: string;
	content: Buffer;
}

const NAME_LENGTH = 0x10;

/**
 * Builds a version 1 archive: the payload offset points straight behind the fixed-width index, which also
 * means the index size implies the version.
 */
function buildPac(entries: readonly Entry[], version: 1 | 2 = 1): Buffer {
	const indexSize =
		INDEX_START + (NAME_LENGTH + (version === 1 ? 8 : 12)) * entries.length;
	const dataOffset = indexSize;
	const offsets: number[] = [];
	let running = dataOffset;
	for (const entry of entries) {
		offsets.push(running);
		running += entry.content.length;
	}

	const archive = Buffer.alloc(running);
	archive.writeInt16LE(entries.length, 0);
	archive.writeUInt8(NAME_LENGTH, 2);
	archive.writeUInt32LE(dataOffset, 3);
	let cursor = INDEX_START;
	for (const [id, entry] of entries.entries()) {
		archive.write(entry.name, cursor, "latin1");
		cursor += NAME_LENGTH;
		if (version === 1) {
			archive.writeUInt32LE((offsets[id] ?? 0) - dataOffset, cursor);
			archive.writeUInt32LE(entry.content.length, cursor + 4);
			cursor += 8;
		} else {
			archive.writeBigInt64LE(BigInt((offsets[id] ?? 0) - dataOffset), cursor);
			archive.writeUInt32LE(entry.content.length, cursor + 8);
			cursor += 12;
		}
		entry.content.copy(archive, offsets[id] ?? 0);
	}
	return archive;
}

/**
 * A script payload. The header doubles as the first record: its 16-bit chunk size is six, which is what the
 * type probe looks for, and the four bytes behind it are the script marker.
 */
function buildScript(body: Buffer): Buffer {
	const payload = Buffer.alloc(4 + 6 + body.length);
	payload.writeInt32LE(1, 0);
	payload.writeUInt16LE(body.length + 4, 4);
	payload.writeUInt32LE(0x140050, 6);
	body.copy(payload, 10);
	return payload;
}

/** A script payload whose second record claims a chunk far beyond its own length. */
function buildBrokenScript(body: Buffer): Buffer {
	const payload = Buffer.alloc(4 + 6 + body.length + 6);
	payload.writeInt32LE(2, 0);
	payload.writeUInt16LE(body.length + 4, 4);
	payload.writeUInt32LE(0x140050, 6);
	body.copy(payload, 10);
	payload.writeUInt16LE(0x4000, 10 + body.length);
	return payload;
}

describe("Tmr-Hiro ADV System resource archive", () => {
	it("lists version 1 entries and marks Ogg payloads as audio", async () => {
		const ogg = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(40, 0x11)]);
		const plain = Buffer.alloc(64, 0x22);
		await expectArchive({
			format: tmrHiroPacFormat,
			archive: buildPac([
				{ name: "sound", content: ogg },
				{ name: "data", content: plain },
			]),
			sourcePath: "sample.pac",
			entries: [
				{ path: "sound.ogg", size: ogg.length, content: ogg },
				{ path: "data", size: plain.length, content: plain },
			],
			metadata: { entryCount: 2, version: 1 },
		});
	});

	it("lists version 2 entries with 64-bit offsets", async () => {
		const content = Buffer.alloc(48, 0x33);
		await expectArchive({
			format: tmrHiroPacFormat,
			archive: buildPac([{ name: "data", content }], 2),
			sourcePath: "sample.pac",
			entries: [{ path: "data", size: content.length, content }],
			metadata: { entryCount: 1, version: 2 },
		});
	});

	it("renames image payloads in a grd archive", async () => {
		const content = Buffer.alloc(32, 0x44);
		content.writeUInt8(1, 0);
		await expectArchive({
			format: tmrHiroPacFormat,
			archive: buildPac([{ name: "cg", content }]),
			sourcePath: "sample_grd.pac",
			entries: [{ path: "cg.grd", size: content.length, content }],
		});
	});

	it("marks wave payloads as audio", async () => {
		const content = Buffer.alloc(64, 0x55);
		content.writeUInt8(0x44, 0);
		content.writeUInt32LE(content.length - 9, 5);
		await expectArchive({
			format: tmrHiroPacFormat,
			archive: buildPac([{ name: "voice", content }]),
			sourcePath: "sample.pac",
			entries: [{ path: "voice", size: content.length, content }],
		});
	});

	it("decodes script payloads", async () => {
		// The first chunk holds the two payload bytes behind the script marker.
		const body = Buffer.from([0x12, 0x34]);
		const payload = buildScript(body);
		const expected = Buffer.from(payload);
		for (let position = 10; position < 12; position += 1)
			expected[position] =
				((expected[position] ?? 0) >>> 4) |
				(((expected[position] ?? 0) << 4) & 0xff);
		await expectArchive({
			format: tmrHiroPacFormat,
			archive: buildPac([{ name: "script", content: payload }]),
			sourcePath: "srp.pac",
			entries: [
				{ path: "script.srp", size: payload.length, content: expected },
			],
		});
	});

	it("keeps a script whose chunk reaches past the payload", async () => {
		// The second record's chunk reaches past the payload, so no transformation is applied at all.
		const payload = buildBrokenScript(Buffer.from([0x12, 0x34]));
		const archive = buildPac([{ name: "script", content: payload }]);
		const handle = await tmrHiroPacFormat.open(
			new BufferByteSource(archive),
			"srp.pac",
		);
		expect(await consumeBuffer(await handle.openEntry("0"))).toEqual(payload);
		await handle.close();
	});

	it("rejects a zero name length", async () => {
		const archive = buildPac([{ name: "a", content: Buffer.alloc(16, 1) }]);
		archive.writeUInt8(0, 2);
		expect(
			await tmrHiroPacFormat.detect(
				new BufferByteSource(archive),
				"sample.pac",
			),
		).toBe(false);
	});

	it("rejects a payload offset that matches no version", async () => {
		const archive = buildPac([{ name: "a", content: Buffer.alloc(16, 1) }]);
		archive.writeUInt32LE(archive.length - 4, 3);
		expect(
			await tmrHiroPacFormat.detect(
				new BufferByteSource(archive),
				"sample.pac",
			),
		).toBe(false);
	});

	it("rejects an insane entry count", async () => {
		const archive = buildPac([{ name: "a", content: Buffer.alloc(16, 1) }]);
		archive.writeInt16LE(0x1000, 0);
		expect(
			await tmrHiroPacFormat.detect(
				new BufferByteSource(archive),
				"sample.pac",
			),
		).toBe(false);
	});

	it("rejects a payload outside the archive", async () => {
		const archive = buildPac([{ name: "a", content: Buffer.alloc(16, 1) }]);
		archive.writeUInt32LE(0x1000, INDEX_START + NAME_LENGTH);
		expect(
			await tmrHiroPacFormat.detect(
				new BufferByteSource(archive),
				"sample.pac",
			),
		).toBe(false);
	});

	it("rejects a file too small for its header", async () => {
		expect(
			await tmrHiroPacFormat.detect(
				new BufferByteSource(Buffer.from([1, 0, 4])),
				"sample.pac",
			),
		).toBe(false);
	});
});
