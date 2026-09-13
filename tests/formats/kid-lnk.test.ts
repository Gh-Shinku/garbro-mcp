import { BufferByteSource } from "@garbro-mcp/core";
import { kidLnkFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_START = 0x10;
const RECORD_SIZE = 0x20;
const LND_STREAM_START = 16;
const LCG_MULTIPLIER = 1103515245;
const LCG_INCREMENT = 39686;

interface Spec {
	name: string;
	stored: Buffer;
	packed?: boolean;
}

/** Lays out a KID archive; record sizes hold the stored size and the packed flag in the low bit. */
function buildLnk(specs: readonly Spec[]): Buffer {
	const records = Buffer.alloc(specs.length * RECORD_SIZE);
	const payloads: Buffer[] = [];
	let offset = 0;
	specs.forEach((spec, id) => {
		const base = id * RECORD_SIZE;
		records.writeUInt32LE(offset, base);
		records.writeUInt32LE(
			(spec.stored.length << 1) | (spec.packed ? 1 : 0),
			base + 4,
		);
		records.write(spec.name, base + 8, "latin1");
		payloads.push(spec.stored);
		offset += spec.stored.length;
	});
	const header = Buffer.alloc(INDEX_START);
	header.write("LNK", 0, "latin1");
	header.writeInt32LE(specs.length, 4);
	return Buffer.concat([header, records, ...payloads]);
}

function literalRun(bytes: Buffer): Buffer {
	if (bytes.length === 0 || bytes.length > 0x20)
		throw new RangeError("literal run length");
	return Buffer.concat([Buffer.from([bytes.length - 1]), bytes]);
}

function fillRun(value: number, count: number): Buffer {
	if (count < 2 || count > 0x21) throw new RangeError("fill run length");
	return Buffer.concat([Buffer.from([0xc0 | (count - 2), value])]);
}

function backRef(offset: number, count: number): Buffer {
	if (count < 2 || count > 0x11) throw new RangeError("copy length");
	if (offset < 1 || offset > 0x400) throw new RangeError("copy offset");
	return Buffer.from([
		0x80 | ((count - 2) << 2) | ((offset - 1) >> 8),
		(offset - 1) & 0xff,
	]);
}

function literalRepeat(bytes: Buffer, repeats: number): Buffer {
	if (bytes.length < 2 || bytes.length > 0x41)
		throw new RangeError("literal run length");
	return Buffer.concat([
		Buffer.from([0x40 | (bytes.length - 2), repeats]),
		bytes,
	]);
}

/** Wraps an Lnd stream in the header the opener expects. */
function lndStream(commands: Buffer, unpackedSize: number): Buffer {
	const header = Buffer.alloc(LND_STREAM_START);
	header.write("lnd", 0, "latin1");
	header.writeUInt32LE(unpackedSize, 8);
	return Buffer.concat([header, commands]);
}

interface CpsOptions {
	keyOffset: number;
	payload: Buffer;
	compression?: number;
	unpackedSize?: number;
}

/**
 * Builds a CPS stream. The reference subtracts a rolling key from every block but the one that sits at
 * the key offset, and the last block of the stream is zeroed.
 */
function buildCps(options: CpsOptions): Buffer {
	if (options.payload.length % 4 !== 0)
		throw new RangeError("Cps payload must be block aligned");
	const body = Buffer.concat([Buffer.alloc(4), options.payload]);
	const packedSize = 0x10 + body.length;
	// The trailer leads to the key field, and the cipher key adds the offset once more.
	const storedKey = (options.keyOffset + 0x3786425) >>> 0;
	const key = (storedKey + options.keyOffset + 0x3786425) >>> 0;
	const encrypted = Buffer.alloc(body.length);
	let position = 0x10;
	let rolling = key;
	for (let offset = 0; offset < body.length; offset += 4) {
		const plain = body.readUInt32LE(offset);
		const value =
			position === options.keyOffset
				? plain
				: (plain + rolling + packedSize) >>> 0;
		encrypted.writeUInt32LE(value, offset);
		position += 4;
		rolling = (Math.imul(LCG_MULTIPLIER, rolling) + LCG_INCREMENT) >>> 0;
	}
	const header = Buffer.alloc(0x10);
	header.writeInt32LE(packedSize, 4);
	header.writeUInt16LE(options.compression ?? 0, 0x0a);
	header.writeInt32LE(options.unpackedSize ?? options.payload.length, 0x0c);
	// The entry opens with the Cps marker; the key offset is resolved from the trailer.
	const marker = Buffer.from("CPS\0", "latin1");
	const filler = Buffer.alloc(options.keyOffset - marker.length);
	const keyField = Buffer.alloc(4);
	keyField.writeUInt32LE(storedKey, 0);
	const trailer = Buffer.alloc(4);
	trailer.writeUInt32LE((options.keyOffset + 0x7534682) >>> 0, 0);
	return Buffer.concat([marker, filler, keyField, header, encrypted, trailer]);
}

describe("KID resource archive", () => {
	it("reads stored entries", async () => {
		const first = Buffer.from("first entry bytes");
		const second = Buffer.from("second entry");
		await expectArchive({
			format: kidLnkFormat,
			sourcePath: "data.dat",
			archive: buildLnk([
				{ name: "a.prt", stored: first },
				{ name: "b.waf", stored: second },
			]),
			entries: [
				{ path: "a.prt", size: first.length, content: first },
				{ path: "b.waf", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("inflates an Lnd stream", async () => {
		const plain = Buffer.from("KID packed payload");
		const commands = Buffer.concat([literalRun(plain), fillRun(0x21, 5)]);
		const stream = lndStream(commands, plain.length + 5);
		await expectArchive({
			format: kidLnkFormat,
			archive: buildLnk([{ name: "a.prt", stored: stream, packed: true }]),
			entries: [
				{
					path: "a.prt",
					size: stream.length,
					content: Buffer.concat([plain, Buffer.alloc(5, 0x21)]),
				},
			],
		});
	});

	it("decodes every Lnd command", async () => {
		const commands = Buffer.concat([
			literalRun(Buffer.from("abcdefgh")),
			backRef(8, 8),
			literalRepeat(Buffer.from("XYZ"), 2),
			fillRun(0x2a, 2),
		]);
		const stream = lndStream(commands, 8 + 8 + 9 + 2);
		const archive = await kidLnkFormat.open(
			new BufferByteSource(
				buildLnk([{ name: "a.prt", stored: stream, packed: true }]),
			),
			"data.dat",
		);
		try {
			const entry = archive.entries[0];
			const data = await consumeBuffer(
				await archive.openEntry(entry?.id ?? ""),
			);
			expect(data.toString("latin1")).toBe("abcdefghabcdefghXYZXYZXYZ**");
		} finally {
			await archive.close();
		}
	});

	it("reads a CPS stream", async () => {
		// The trailing block of a CPS stream is always zeroed, so the payload has to end in zeroes.
		const payload = Buffer.alloc(24);
		payload.write("CPS payload", 0, "latin1");
		const cps = buildCps({ keyOffset: 0x20, payload });
		await expectArchive({
			format: kidLnkFormat,
			archive: buildLnk([{ name: "a.prt", stored: cps }]),
			entries: [{ path: "a.prt", size: cps.length, content: payload }],
		});
	});

	it("reads a deflated CPS stream", async () => {
		const plain = Buffer.from("inner lnd body!");
		// The Cps body already carries the skipped word, so the commands follow right behind it. Four
		// trailing zeroes keep the zeroed stream block out of the commands.
		const payload = Buffer.concat([
			Buffer.from([plain.length - 1]),
			plain,
			Buffer.alloc(4),
		]);
		const cps = buildCps({
			keyOffset: 0x18,
			payload,
			compression: 1,
			unpackedSize: plain.length,
		});
		await expectArchive({
			format: kidLnkFormat,
			archive: buildLnk([{ name: "a.prt", stored: cps }]),
			entries: [{ path: "a.prt", size: cps.length, content: plain }],
		});
	});

	it("rejects Lnd16 compression", async () => {
		const cps = buildCps({
			keyOffset: 0x18,
			payload: Buffer.alloc(8),
			compression: 2,
			unpackedSize: 8,
		});
		const archive = await kidLnkFormat.open(
			new BufferByteSource(buildLnk([{ name: "a.prt", stored: cps }])),
			"data.dat",
		);
		try {
			const entry = archive.entries[0];
			await expect(archive.openEntry(entry?.id ?? "")).rejects.toThrow("Lnd16");
		} finally {
			await archive.close();
		}
	});

	it("registers the lnk signature", () => {
		const signatures = kidLnkFormat.detection?.signatures ?? [];
		expect(Buffer.from(signatures[0]?.bytes ?? []).toString("latin1")).toBe(
			"LNK",
		);
	});

	it("rejects an empty entry name", async () => {
		const file = buildLnk([{ name: "", stored: Buffer.from("data") }]);
		expect(await kidLnkFormat.detect(new BufferByteSource(file))).toBe(false);
	});

	it("rejects an insane count", async () => {
		const file = buildLnk([{ name: "a.prt", stored: Buffer.from("data") }]);
		file.writeInt32LE(0, 4);
		expect(await kidLnkFormat.detect(new BufferByteSource(file))).toBe(false);
	});

	it("rejects an entry outside the file", async () => {
		const file = buildLnk([{ name: "a.prt", stored: Buffer.from("data") }]);
		file.writeUInt32LE(0x1000, INDEX_START + 4);
		expect(await kidLnkFormat.detect(new BufferByteSource(file))).toBe(false);
	});

	it("rejects a truncated index", async () => {
		const file = buildLnk([{ name: "a.prt", stored: Buffer.from("data") }]);
		expect(
			await kidLnkFormat.detect(new BufferByteSource(file.subarray(0, 20))),
		).toBe(false);
	});

	it("rejects a blank name", async () => {
		const file = buildLnk([{ name: "", stored: Buffer.from("data") }]);
		file.fill(0x20, INDEX_START + 8, INDEX_START + 8 + 0x18);
		expect(await kidLnkFormat.detect(new BufferByteSource(file))).toBe(false);
	});
});
