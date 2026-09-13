import { BufferByteSource } from "@garbro-mcp/core";
import { deflateSync } from "node:zlib";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { alicesoftAfaFormat } from "../../packages/formats/src/alicesoft/afa.js";

const INDEX_OFFSET = 0x2c;
const AFF_KEY = Buffer.from([
	0xc8, 0xbb, 0x8f, 0xb7, 0xed, 0x43, 0x99, 0x4a, 0xa2, 0x7e, 0x5b, 0xb0, 0x68,
	0x18, 0xf8, 0x88,
]);

interface AfaEntry {
	name: string;
	offset: number;
	size: number;
}

/** Builds the index records: name length, step, name, skipped words, offset and size. */
function buildIndex(entries: AfaEntry[], version: number): Buffer {
	const parts: Buffer[] = [];
	for (const entry of entries) {
		const name = Buffer.from(entry.name, "latin1");
		const head = Buffer.alloc(8);
		head.writeInt32LE(name.length, 0);
		head.writeInt32LE(name.length, 4);
		const tail = Buffer.alloc(version < 2 ? 20 : 16);
		tail.writeUInt32LE(entry.offset, version < 2 ? 12 : 8);
		tail.writeUInt32LE(entry.size, version < 2 ? 16 : 12);
		parts.push(Buffer.concat([head, name, tail]));
	}
	return Buffer.concat(parts);
}

/**
 * Builds an `AFF` payload: a sixteen byte header and a body whose first forty bytes, or all of it
 * when it is shorter, are masked with the repeating key.
 */
function buildAff(plain: Buffer): Buffer {
	const header = Buffer.alloc(0x10);
	header.write("AFF\0", 0, "latin1");
	const masked = Buffer.from(plain);
	const count = Math.min(0x40, masked.length);
	for (let index = 0; index < count; index += 1)
		masked[index] =
			(masked[index] ?? 0) ^ (AFF_KEY[index % AFF_KEY.length] ?? 0);
	return Buffer.concat([header, masked]);
}

/**
 * Builds an AliceSoft AFA archive: the fixed header, the zlib compressed index and the payloads at
 * the offsets the index records.
 */
function buildAfa(
	entries: { name: string; data: Buffer }[],
	options: {
		version?: number;
		base?: number;
		count?: number;
		info?: string;
	} = {},
): Buffer {
	const base = options.base ?? 0;
	const version = options.version ?? 2;
	let position = INDEX_OFFSET + 0x100;
	const records: AfaEntry[] = [];
	const payloads: { offset: number; data: Buffer }[] = [];
	for (const entry of entries) {
		records.push({
			name: entry.name,
			offset: position - base,
			size: entry.data.length,
		});
		payloads.push({ offset: position, data: entry.data });
		position += entry.data.length;
	}
	const index = buildIndex(records, version);
	const packed = deflateSync(index);
	const head = Buffer.alloc(INDEX_OFFSET);
	head.write("AFAH", 0, "latin1");
	head.write("AlicArch", 8, "latin1");
	head.writeInt32LE(version, 0x10);
	head.writeUInt32LE(base, 0x18);
	head.write(options.info ?? "INFO", 0x1c, "latin1");
	head.writeUInt32LE(packed.length, 0x20);
	head.writeInt32LE(index.length, 0x24);
	head.writeInt32LE(options.count ?? entries.length, 0x28);
	const length = Math.max(
		INDEX_OFFSET + packed.length,
		...payloads.map((payload) => payload.offset + payload.data.length),
	);
	const file = Buffer.alloc(length);
	head.copy(file, 0);
	packed.copy(file, INDEX_OFFSET);
	for (const payload of payloads) payload.data.copy(file, payload.offset);
	return file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("alicesoft afa", () => {
	it("lists entries and extracts them", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload bytes");
		const file = buildAfa([
			{ name: "DATA\\FILE.BIN", data: first },
			{ name: "FILE2.BIN", data: second },
		]);
		const source = sourceOf(file);
		expect(await alicesoftAfaFormat.detect(source)).toBe(true);
		const archive = await alicesoftAfaFormat.open(source, "game.afa");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"DATA/FILE.BIN",
				"FILE2.BIN",
			]);
			expect(archive.entries[0]?.rawPath).toBe("DATA\\FILE.BIN");
			expect(archive.entries.map((entry) => Number(entry.size))).toEqual([
				first.length,
				second.length,
			]);
			const entry = archive.entries[1];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				second,
			);
		} finally {
			await archive.close();
		}
	});

	it("unmasks the aff prefix of an entry", async () => {
		// Only the first forty bytes of the payload are masked, the rest is stored plain.
		const plain = Buffer.concat([
			Buffer.from("first part of the payload"),
			Buffer.alloc(0x40),
		]);
		const file = buildAfa([{ name: "IMAGE.QNT", data: buildAff(plain) }]);
		const source = sourceOf(file);
		const archive = await alicesoftAfaFormat.open(source, "game.afa");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.encrypted).toBe(true);
			expect(entry.metadata).toMatchObject({ affPrefix: 0x40 });
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(0x10 + plain.length);
			expect(output.subarray(0, 4).toString("latin1")).toBe("AFF\0");
			expect(output.subarray(0x10)).toEqual(plain);
		} finally {
			await archive.close();
		}
	});

	it("keeps a short aff payload intact apart from the prefix", async () => {
		const plain = Buffer.from("short payload");
		const file = buildAfa([{ name: "SMALL.AJP", data: buildAff(plain) }]);
		const source = sourceOf(file);
		const archive = await alicesoftAfaFormat.open(source, "game.afa");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.metadata).toMatchObject({ affPrefix: plain.length });
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(Number(entry.size)).toBe(output.length);
			expect(output.subarray(0x10)).toEqual(plain);
		} finally {
			await archive.close();
		}
	});

	it("reads the older record layout", async () => {
		const data = Buffer.from("version one payload");
		const file = buildAfa([{ name: "OLD.BIN", data }], { version: 1 });
		const source = sourceOf(file);
		const archive = await alicesoftAfaFormat.open(source, "old.afa");
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

	it("applies the base offset from the header", async () => {
		const data = Buffer.from("shifted payload");
		const file = buildAfa([{ name: "SHIFT.BIN", data }], { base: 0x20 });
		const source = sourceOf(file);
		const archive = await alicesoftAfaFormat.open(source, "game.afa");
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

	it("declines a file without the info marker", async () => {
		const file = buildAfa([{ name: "A.BIN", data: Buffer.from("x") }], {
			info: "NOPE",
		});
		expect(await alicesoftAfaFormat.detect(sourceOf(file))).toBe(false);
	});

	it("declines an insane entry count", async () => {
		const file = buildAfa([{ name: "A.BIN", data: Buffer.from("x") }], {
			count: 0x100000,
		});
		expect(await alicesoftAfaFormat.detect(sourceOf(file))).toBe(false);
	});

	it("declines an entry that does not fit in the file", async () => {
		const file = buildAfa([{ name: "A.BIN", data: Buffer.from("payload") }]);
		const index = deflateSync(
			buildIndex([{ name: "A.BIN", offset: 0x2000, size: 0x100 }], 2),
		);
		index.copy(file, INDEX_OFFSET);
		file.writeUInt32LE(index.length, 0x20);
		expect(await alicesoftAfaFormat.detect(sourceOf(file))).toBe(false);
	});
});
