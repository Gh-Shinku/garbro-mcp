import { BufferByteSource } from "@garbro-mcp/core";
import type { ArchiveEntry } from "@garbro-mcp/core";
import { valkyriaOdnFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const RECORD_SIZE = 0x10;
const V1_END = "END_ffffffffffff";
const V1_TERMINATOR = "ffffffffffffffff";
const MASKED_OGG_SIGNATURE = 0x5e6a6a42;
const OGG_MASK = 0x0d;

function record(name: string, offset: number, size = RECORD_SIZE): Buffer {
	const data = Buffer.alloc(size);
	data.write(name.slice(0, 8).padEnd(8, "\0"), 0, "latin1");
	data.write(offset.toString(16).padStart(8, "0"), 8, "latin1");
	return data;
}

/** The countdown mask of the encrypted layout, which is its own inverse. */
function xorCountdown(data: Buffer, key: number): number {
	let current = key & 0xff;
	for (let i = 0; i < data.length; i += 1) {
		data[i] = (data[i] ?? 0) ^ current;
		current = (current - 1) & 0xff;
	}
	return current;
}

function xorConstant(data: Buffer, key: number): Buffer {
	return Buffer.from(data.map((value) => value ^ key));
}

interface DataSpec {
	name: string;
	payload: Buffer;
}

/** Builds a version one archive: relative offsets in sixteen byte text records. */
function buildV1(specs: DataSpec[], terminator = V1_END): Buffer {
	const records: Buffer[] = [];
	let offset = 0;
	for (const spec of specs) {
		records.push(record(spec.name, offset));
		offset += spec.payload.length;
	}
	records.push(Buffer.from(terminator, "latin1"));
	return Buffer.concat([...records, ...specs.map((spec) => spec.payload)]);
}

/**
 * Builds a version two archive: absolute offsets, the first offset bounds the index, and a trailing
 * record that points at the end of the file terminates the list. The terminator shares the first
 * four characters of its name with the first record, which is how the layout is recognised.
 */
function buildV2(specs: DataSpec[], recordSize = RECORD_SIZE): Buffer {
	const indexSize = (specs.length + 1) * recordSize;
	const records: Buffer[] = [];
	let offset = indexSize;
	for (const spec of specs) {
		records.push(record(spec.name, offset, recordSize));
		offset += spec.payload.length;
	}
	const prefix = specs[0]?.name.slice(0, 4) ?? "TEST";
	records.push(record(`${prefix}0000`, offset, recordSize));
	return Buffer.concat([...records, ...specs.map((spec) => spec.payload)]);
}

/** Builds a masked archive: every index record is masked with the running countdown key. */
function buildEncrypted(specs: DataSpec[]): Buffer {
	const plain: Buffer[] = [];
	let offset = 0;
	for (const spec of specs) {
		plain.push(record(spec.name, offset));
		offset += spec.payload.length;
	}
	plain.push(Buffer.from(V1_TERMINATOR, "latin1"));
	const records: Buffer[] = [];
	let key = 0xff;
	for (const entry of plain) {
		const data = Buffer.from(entry);
		key = xorCountdown(data, key);
		records.push(data);
	}
	return Buffer.concat([...records, ...specs.map((spec) => spec.payload)]);
}

/** The entry offsets survive at runtime but are not part of the read back type. */
function entryOffset(entry: ArchiveEntry): number {
	return Number((entry as unknown as { offset: bigint }).offset);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

const DOCUMENT = Buffer.from("script body");

describe("valkyria odn", () => {
	it("lists a version one index with relative offsets", async () => {
		const payload = Buffer.from("1234567890");
		const file = buildV1([
			{ name: "back0001", payload },
			{ name: "scrp0001", payload: DOCUMENT },
		]);
		const source = sourceOf(file);
		expect(await valkyriaOdnFormat.detect(source, "GAME.ODN")).toBe(true);
		const archive = await valkyriaOdnFormat.open(source, "GAME.ODN");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"back0001",
				"scrp0001",
			]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "image" });
			expect(archive.entries[1]?.metadata).toMatchObject({ type: "script" });
			// Relative offsets are shifted by the end of the index, two records plus the marker.
			const first = archive.entries[0];
			if (!first) throw new Error("missing entry");
			expect(entryOffset(first)).toBe(0x30);
			expect(Number(archive.entries[0]?.size)).toBe(payload.length);
			expect(Number(archive.entries[1]?.size)).toBe(DOCUMENT.length);
		} finally {
			await archive.close();
		}
	});

	it("unmasks script payloads when the index did not turn that off", async () => {
		// The first payload sits behind one record and the end marker, so the offset is known.
		const offset = 0x20;
		const stored = Buffer.from(DOCUMENT);
		xorCountdown(stored, ~offset & 0xff);
		const file = buildV1([{ name: "scrp0001", payload: stored }]);
		const source = sourceOf(file);
		const archive = await valkyriaOdnFormat.open(source, "GAME.ODN");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.encrypted).toBe(true);
			expect(entryOffset(entry)).toBe(offset);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				DOCUMENT,
			);
		} finally {
			await archive.close();
		}
	});

	it("leaves script payloads alone after the alternate terminator", async () => {
		const file = buildV1(
			[{ name: "scrp0001", payload: DOCUMENT }],
			V1_TERMINATOR,
		);
		const source = sourceOf(file);
		const archive = await valkyriaOdnFormat.open(source, "GAME.ODN");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.encrypted).toBe(false);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				DOCUMENT,
			);
		} finally {
			await archive.close();
		}
	});

	it("lists a version two index with absolute offsets", async () => {
		const payload = Buffer.from("0123456789");
		const file = buildV2([
			{ name: "TEST0001", payload },
			{ name: "TEST0002", payload },
		]);
		const source = sourceOf(file);
		expect(await valkyriaOdnFormat.detect(source, "GAME.DAT")).toBe(true);
		const archive = await valkyriaOdnFormat.open(source, "GAME.DAT");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"TEST0001",
				"TEST0002",
			]);
			const first = archive.entries[0];
			if (!first) throw new Error("missing entry");
			expect(entryOffset(first)).toBe(0x30);
			expect(Number(archive.entries[1]?.size)).toBe(payload.length);
		} finally {
			await archive.close();
		}
	});

	it("lists a version two index with longer records", async () => {
		const payload = Buffer.from("records");
		const file = buildV2([{ name: "TEST0001", payload }], 0x18);
		const source = sourceOf(file);
		const archive = await valkyriaOdnFormat.open(source, "GAME.ODN");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["TEST0001"]);
			expect(Number(archive.entries[0]?.size)).toBe(payload.length);
		} finally {
			await archive.close();
		}
	});

	it("lists an index masked with the countdown key", async () => {
		const payload = Buffer.from("hidden body");
		const file = buildEncrypted([{ name: "MASK0001", payload }]);
		const source = sourceOf(file);
		expect(await valkyriaOdnFormat.detect(source, "GAME.ODN")).toBe(true);
		const archive = await valkyriaOdnFormat.open(source, "GAME.ODN");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["MASK0001"]);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				payload,
			);
		} finally {
			await archive.close();
		}
	});

	it("prepends a riff header to audio entries", async () => {
		const payload = Buffer.alloc(0x20, 0x11);
		const file = buildV1([{ name: "hime0001", payload }]);
		const source = sourceOf(file);
		const archive = await valkyriaOdnFormat.open(source, "GAME.ODN");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.metadata).toMatchObject({ type: "audio" });
			const data = await consumeBuffer(await archive.openEntry(entry.id));
			expect(data.length).toBe(44 + payload.length);
			expect(data.subarray(0, 4).toString("latin1")).toBe("RIFF");
			expect(data.subarray(8, 12).toString("latin1")).toBe("WAVE");
			expect(data.readUInt32LE(4)).toBe(36 + payload.length);
			expect(data.readUInt32LE(24)).toBe(44100);
			expect(data.subarray(44)).toEqual(payload);
		} finally {
			await archive.close();
		}
	});

	it("unmasks an ogg payload", async () => {
		const plain = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(8, 0x33)]);
		expect(plain.readUInt32LE(0)).toBe(MASKED_OGG_SIGNATURE ^ 0x0d0d0d0d);
		const file = buildV1([
			{ name: "voice01", payload: xorConstant(plain, OGG_MASK) },
		]);
		const source = sourceOf(file);
		const archive = await valkyriaOdnFormat.open(source, "GAME.ODN");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.metadata).toMatchObject({ masked: true });
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				plain,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file with an unrelated extension", async () => {
		const file = buildV1([{ name: "back0001", payload: Buffer.from("data") }]);
		expect(await valkyriaOdnFormat.detect(sourceOf(file), "sample.bin")).toBe(
			false,
		);
	});

	it("declines an index with a broken offset field", async () => {
		const file = buildV1([{ name: "back0001", payload: Buffer.from("data") }]);
		file.write("ZZZZZZZZ", 8, "latin1");
		expect(await valkyriaOdnFormat.detect(sourceOf(file), "GAME.ODN")).toBe(
			false,
		);
	});

	it("declines an index without entries", async () => {
		const file = Buffer.concat([
			Buffer.from(V1_END, "latin1"),
			Buffer.alloc(0x10),
		]);
		expect(await valkyriaOdnFormat.detect(sourceOf(file), "GAME.ODN")).toBe(
			false,
		);
	});

	it("declines a truncated index record", async () => {
		const file = Buffer.from("back000100000010", "latin1");
		expect(await valkyriaOdnFormat.detect(sourceOf(file), "GAME.ODN")).toBe(
			false,
		);
	});

	it("declines a version two index without the repeated name", async () => {
		const file = buildV2([{ name: "TEST0001", payload: Buffer.from("data") }]);
		file.write("OTHER001", 0x10, "latin1");
		expect(await valkyriaOdnFormat.detect(sourceOf(file), "GAME.ODN")).toBe(
			false,
		);
	});
});
