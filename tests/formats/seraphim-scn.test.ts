import { BufferByteSource } from "@garbro-mcp/core";
import { seraphimScn95Format, seraphimScnFormat } from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_START = 4;

/** An uncompressed ArchAngel script stream: a literal run that reproduces the payload. */
function literalScript(data: Buffer): Buffer {
	const header = Buffer.alloc(4);
	header.writeInt32LE(data.length, 0);
	const body: number[] = [];
	for (let offset = 0; offset < data.length; offset += 0x40) {
		const chunk = data.subarray(offset, offset + 0x40);
		body.push(chunk.length - 1, ...chunk);
	}
	return Buffer.concat([header, Buffer.from(body)]);
}

/** `ScnOpener` layout: a count, one offset per script plus a closing offset, then the scripts. */
function buildScn(payloads: readonly Buffer[]): Buffer {
	const tableSize = INDEX_START + 4 * (payloads.length + 1);
	const offsets: number[] = [];
	let offset = tableSize;
	for (const payload of payloads) {
		offsets.push(offset);
		offset += payload.length;
	}
	offsets.push(offset);
	const header = Buffer.alloc(4);
	header.writeInt32LE(payloads.length, 0);
	const table = Buffer.alloc(4 * offsets.length);
	for (const [id, value] of offsets.entries())
		table.writeUInt32LE(value, id * 4);
	return Buffer.concat([header, table, ...payloads]);
}

/** `Scn95Opener` layout: the size of the size table, the sizes, then the scripts. */
function buildScn95(payloads: readonly Buffer[]): Buffer {
	const tableSize = 4 * payloads.length;
	const header = Buffer.alloc(4);
	header.writeUInt32LE(tableSize, 0);
	const table = Buffer.alloc(tableSize);
	for (const [id, payload] of payloads.entries())
		table.writeUInt32LE(payload.length, id * 4);
	return Buffer.concat([header, table, ...payloads]);
}

describe("Seraphim engine scripts archive", () => {
	it("reads the offset table", async () => {
		const first = literalScript(Buffer.from("first"));
		const second = literalScript(Buffer.from("second script"));
		await expectArchive({
			format: seraphimScnFormat,
			sourcePath: "SCNPAC.DAT",
			archive: buildScn([first, second]),
			entries: [
				{ path: "00000", size: first.length, content: Buffer.from("first") },
				{
					path: "00001",
					size: second.length,
					content: Buffer.from("second script"),
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("inflates a zlib payload before the script pass", async () => {
		const script = literalScript(Buffer.from("compressed script"));
		const payload = deflateSync(script, { level: 0 });
		await expectArchive({
			format: seraphimScnFormat,
			sourcePath: "SCNPAC.DAT",
			archive: buildScn([payload]),
			entries: [
				{
					path: "00000",
					size: payload.length,
					content: Buffer.from("compressed script"),
				},
			],
		});
	});

	it("inflates a marked payload without the script pass", async () => {
		const data = Buffer.from("plain inflated script");
		const payload = Buffer.concat([
			Buffer.from([1, 0, 0, 0]),
			deflateSync(data),
		]);
		await expectArchive({
			format: seraphimScnFormat,
			sourcePath: "SCNPAC.DAT",
			archive: buildScn([payload]),
			entries: [{ path: "00000", size: payload.length, content: data }],
		});
	});

	it("keeps the stored bytes when the script does not decode", async () => {
		const payload = Buffer.alloc(0x20, 0x7f);
		payload.writeInt32LE(0x1000, 0);
		await expectArchive({
			format: seraphimScnFormat,
			sourcePath: "SCNPAC.DAT",
			archive: buildScn([payload]),
			entries: [{ path: "00000", size: payload.length, content: payload }],
		});
	});

	it("returns nothing for an empty script", async () => {
		// The unpacked size doubles as a signature, so it has to reach four for the script pass.
		const payload = literalScript(Buffer.from("abcd"));
		await expectArchive({
			format: seraphimScnFormat,
			sourcePath: "SCNPAC.DAT",
			archive: buildScn([payload, Buffer.alloc(0)]),
			entries: [
				{ path: "00000", size: payload.length, content: Buffer.from("abcd") },
				{ path: "00001", size: 0, content: Buffer.alloc(0) },
			],
		});
	});

	it("rejects a different file name", async () => {
		expect(
			await seraphimScnFormat.detect(
				new BufferByteSource(buildScn([literalScript(Buffer.from("a"))])),
				"/game/OTHER.DAT",
			),
		).toBe(false);
		expect(
			await seraphimScn95Format.detect(
				new BufferByteSource(buildScn95([literalScript(Buffer.from("a"))])),
				"/game/OTHER.DAT",
			),
		).toBe(false);
	});

	it("rejects an offset that reaches into the index", async () => {
		const file = buildScn([literalScript(Buffer.from("a"))]);
		file.writeUInt32LE(4, INDEX_START);
		expect(
			await seraphimScnFormat.detect(
				new BufferByteSource(file),
				"/game/SCNPAC.DAT",
			),
		).toBe(false);
	});

	it("rejects a descending offset", async () => {
		const file = buildScn([literalScript(Buffer.from("a"))]);
		file.writeUInt32LE(0, INDEX_START + 4);
		expect(
			await seraphimScnFormat.detect(
				new BufferByteSource(file),
				"/game/SCNPAC.DAT",
			),
		).toBe(false);
	});

	it("rejects an insane count", async () => {
		const file = buildScn([literalScript(Buffer.from("a"))]);
		file.writeInt32LE(0, 0);
		expect(
			await seraphimScnFormat.detect(
				new BufferByteSource(file),
				"/game/SCNPAC.DAT",
			),
		).toBe(false);
	});
});

describe("Archangel engine scripts archive", () => {
	it("reads the size table", async () => {
		const first = literalScript(Buffer.from("first"));
		const second = literalScript(Buffer.from("second script"));
		await expectArchive({
			format: seraphimScn95Format,
			sourcePath: "SCNPAC.DAT",
			archive: buildScn95([first, second]),
			entries: [
				{ path: "00000", size: first.length, content: Buffer.from("first") },
				{
					path: "00001",
					size: second.length,
					content: Buffer.from("second script"),
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("inflates a zlib payload", async () => {
		const script = literalScript(Buffer.from("inflated"));
		const payload = deflateSync(script, { level: 0 });
		await expectArchive({
			format: seraphimScn95Format,
			sourcePath: "SCNPAC.DAT",
			archive: buildScn95([payload]),
			entries: [
				{
					path: "00000",
					size: payload.length,
					content: Buffer.from("inflated"),
				},
			],
		});
	});

	it("rejects an empty size", async () => {
		const file = buildScn95([literalScript(Buffer.from("a"))]);
		file.writeUInt32LE(0, INDEX_START);
		expect(
			await seraphimScn95Format.detect(
				new BufferByteSource(file),
				"/game/SCNPAC.DAT",
			),
		).toBe(false);
	});

	it("rejects a table that leaves the file", async () => {
		const file = buildScn95([literalScript(Buffer.from("a"))]);
		file.writeUInt32LE(file.length + 4, 0);
		expect(
			await seraphimScn95Format.detect(
				new BufferByteSource(file),
				"/game/SCNPAC.DAT",
			),
		).toBe(false);
	});

	it("rejects an entry that leaves the file", async () => {
		const file = buildScn95([literalScript(Buffer.from("a"))]);
		file.writeUInt32LE(0x1000, INDEX_START);
		expect(
			await seraphimScn95Format.detect(
				new BufferByteSource(file),
				"/game/SCNPAC.DAT",
			),
		).toBe(false);
	});
});
