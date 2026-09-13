import { BufferByteSource } from "@garbro-mcp/core";
import { kurumiMpkFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const NAME_SIZE = 0xf8;
const RECORD_SIZE = NAME_SIZE + 12;
const HEADER_SIZE = 12;

/** Every index and payload is a nine byte block: big endian unpacked size, flag, filler. */
function block(payload: Buffer, flag = 0): Buffer {
	const header = Buffer.alloc(9);
	header.writeUInt32BE(payload.length, 0);
	header[8] = flag;
	return Buffer.concat([header, payload]);
}

interface EntrySpec {
	name: string;
	payload: Buffer;
	flag?: number;
}

interface BuildOptions {
	version?: number;
	count?: number;
	indexFlag?: number;
}

interface Built {
	file: Buffer;
	indexOffset: number;
}

/** Builds an archive: header, index block and payload blocks. */
function buildMpk(specs: EntrySpec[], options: BuildOptions = {}): Built {
	const records: Buffer[] = [];
	const payloads: Buffer[] = [];
	let relative = 0;
	for (const spec of specs) {
		const stored = block(spec.payload, spec.flag ?? 0);
		const record = Buffer.alloc(RECORD_SIZE);
		Buffer.from(spec.name, "latin1").copy(record, 0);
		record.writeUInt32LE(relative, NAME_SIZE);
		record.writeUInt32LE(stored.length, NAME_SIZE + 4);
		record.writeUInt32LE(spec.payload.length, NAME_SIZE + 8);
		records.push(record);
		payloads.push(stored);
		relative += stored.length;
	}
	const indexBlob = block(Buffer.concat(records), options.indexFlag ?? 0);
	const dataOffset = HEADER_SIZE + indexBlob.length;
	const header = Buffer.alloc(HEADER_SIZE);
	header.write("MP", 0, "latin1");
	header[2] = options.version ?? 1;
	header.writeInt32LE(options.count ?? specs.length, 4);
	header.writeUInt32LE(dataOffset, 8);
	return {
		file: Buffer.concat([header, indexBlob, ...payloads]),
		indexOffset: HEADER_SIZE + 9,
	};
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

const FIRST = Buffer.from("first payload body");
const SECOND = Buffer.alloc(0x30, 0x5a);
const SPECS: EntrySpec[] = [
	{ name: "FIRST.BIN", payload: FIRST },
	{ name: "SECOND.DAT", payload: SECOND },
];

describe("kurumi mpk", () => {
	it("declares the MP signature for the registry", () => {
		expect(kurumiMpkFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("MP", "latin1") },
		]);
	});

	it("lists the decompressed index", async () => {
		const { file } = buildMpk(SPECS);
		const source = sourceOf(file);
		expect(await kurumiMpkFormat.detect(source, "GAME.MPK")).toBe(true);
		const archive = await kurumiMpkFormat.open(source, "GAME.MPK");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"FIRST.BIN",
				"SECOND.DAT",
			]);
			expect(archive.metadata).toMatchObject({ entryCount: 2 });
			expect(archive.entries[0]?.metadata).toMatchObject({
				unpackedSize: FIRST.length,
			});
			expect(archive.entries[1]?.metadata).toMatchObject({
				unpackedSize: SECOND.length,
			});
			// The stored size covers the nine byte block header as well.
			expect(Number(archive.entries[0]?.size)).toBe(FIRST.length + 9);
		} finally {
			await archive.close();
		}
	});

	it("extracts an unpacked payload", async () => {
		const { file } = buildMpk(SPECS);
		const source = sourceOf(file);
		const archive = await kurumiMpkFormat.open(source, "GAME.MPK");
		try {
			const first = archive.entries[0];
			const second = archive.entries[1];
			if (!first || !second) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(first.id))).toEqual(
				FIRST,
			);
			expect(await consumeBuffer(await archive.openEntry(second.id))).toEqual(
				SECOND,
			);
		} finally {
			await archive.close();
		}
	});

	it("passes a packed payload through until the codec is ported", async () => {
		const stored = block(FIRST, 1);
		const { file } = buildMpk([
			{ name: "PACKED.BIN", payload: FIRST, flag: 1 },
		]);
		const source = sourceOf(file);
		const archive = await kurumiMpkFormat.open(source, "GAME.MPK");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				stored,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a packed index", async () => {
		const { file } = buildMpk(SPECS, { indexFlag: 1 });
		expect(await kurumiMpkFormat.detect(sourceOf(file), "GAME.MPK")).toBe(
			false,
		);
	});

	it("declines an unknown version", async () => {
		const { file } = buildMpk(SPECS, { version: 2 });
		expect(await kurumiMpkFormat.detect(sourceOf(file), "GAME.MPK")).toBe(
			false,
		);
	});

	it("declines an insane entry count", async () => {
		const { file } = buildMpk(SPECS, { count: 0x80000 });
		expect(await kurumiMpkFormat.detect(sourceOf(file), "GAME.MPK")).toBe(
			false,
		);
	});

	it("declines an index that does not hold every record", async () => {
		const { file } = buildMpk([SPECS[0] as EntrySpec], { count: 2 });
		expect(await kurumiMpkFormat.detect(sourceOf(file), "GAME.MPK")).toBe(
			false,
		);
	});

	it("declines a data offset inside the header", async () => {
		const { file } = buildMpk(SPECS);
		file.writeUInt32LE(12, 8);
		expect(await kurumiMpkFormat.detect(sourceOf(file), "GAME.MPK")).toBe(
			false,
		);
	});

	it("declines a data offset past the end of the file", async () => {
		const { file } = buildMpk(SPECS);
		file.writeUInt32LE(file.length + 0x100, 8);
		expect(await kurumiMpkFormat.detect(sourceOf(file), "GAME.MPK")).toBe(
			false,
		);
	});

	it("declines a payload outside the file", async () => {
		const { file, indexOffset } = buildMpk(SPECS);
		file.writeUInt32LE(0x100000, indexOffset + NAME_SIZE);
		expect(await kurumiMpkFormat.detect(sourceOf(file), "GAME.MPK")).toBe(
			false,
		);
	});

	it("declines a file without the signature", async () => {
		const { file } = buildMpk(SPECS);
		file.write("XX", 0, "latin1");
		expect(await kurumiMpkFormat.detect(sourceOf(file), "GAME.MPK")).toBe(
			false,
		);
	});
});
