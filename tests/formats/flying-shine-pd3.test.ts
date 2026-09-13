import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { flyingShinePd3Format } from "../../packages/formats/src/flying-shine/pd.js";

const INDEX_OFFSET = 0x18;
const RECORD_SIZE = 0x11c;

interface Pd3Record {
	name: string;
	data: Buffer;
	/** A zero slot leaves the record's first byte clear. */
	empty?: boolean;
}

interface Pd3Options {
	indexCount?: number;
	count?: number;
	totalSize?: number;
}

/** Builds an archive whose index holds fixed size records and whose payloads follow the index. */
function buildPd3(records: Pd3Record[], options: Pd3Options = {}): Buffer {
	const indexCount = options.indexCount ?? records.length;
	const count = options.count ?? records.length;
	const indexSize = RECORD_SIZE * indexCount;
	const baseOffset = INDEX_OFFSET + indexSize;
	const layout: ({ offset: number; data: Buffer } | undefined)[] = [];
	let position = baseOffset;
	for (const record of records) {
		if (record.empty) {
			layout.push(undefined);
			continue;
		}
		layout.push({ offset: position, data: record.data });
		position += record.data.length;
	}
	const file = Buffer.alloc(position);
	file.writeInt32LE(indexCount, 0);
	file.writeInt32LE(count, 4);
	file.writeUInt32LE(options.totalSize ?? position - baseOffset, 0xc);
	records.forEach((record, index) => {
		const payload = layout[index];
		if (!payload) return;
		const at = INDEX_OFFSET + index * RECORD_SIZE;
		file.write(record.name, at, "latin1");
		file.writeUInt32LE(record.data.length, at + 0x108);
		file.writeUInt32LE(payload.offset - baseOffset, at + 0x10c);
		payload.data.copy(file, payload.offset);
	});
	return file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("flying-shine pd3", () => {
	it("lists entries and extracts them", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload, longer than the first");
		const file = buildPd3([
			{ name: "IMAGE.PNG", data: first },
			{ name: "DATA.BIN", data: second },
		]);
		const source = sourceOf(file);
		expect(await flyingShinePd3Format.detect(source)).toBe(true);
		const archive = await flyingShinePd3Format.open(source, "game.pd");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"IMAGE.PNG",
				"DATA.BIN",
			]);
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

	it("rotates script payloads right by four bits", async () => {
		const plain = Buffer.from([0x12, 0x34, 0xab, 0xcd]);
		const stored = Buffer.from(
			plain.map((value) => ((value >> 4) | (value << 4)) & 0xff),
		);
		const file = buildPd3([{ name: "SCRIPT.DEF", data: stored }]);
		const source = sourceOf(file);
		const archive = await flyingShinePd3Format.open(source, "game.pd");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.encrypted).toBe(true);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				plain,
			);
		} finally {
			await archive.close();
		}
	});

	it("skips empty index slots", async () => {
		const data = Buffer.from("kept payload");
		const file = buildPd3([
			{ name: "", data: Buffer.alloc(0), empty: true },
			{ name: "KEPT.BIN", data },
		]);
		const source = sourceOf(file);
		const archive = await flyingShinePd3Format.open(source, "game.pd");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["KEPT.BIN"]);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				data,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines an index smaller than the entry count", async () => {
		const file = buildPd3([{ name: "A.BIN", data: Buffer.from("x") }], {
			indexCount: 1,
			count: 4,
		});
		expect(await flyingShinePd3Format.detect(sourceOf(file))).toBe(false);
	});

	it("declines an index that fills the file", async () => {
		const file = buildPd3([{ name: "A.BIN", data: Buffer.from("x") }]);
		// Ask for far more records than the file can hold.
		file.writeInt32LE(0x1000, 0);
		file.writeInt32LE(1, 4);
		expect(await flyingShinePd3Format.detect(sourceOf(file))).toBe(false);
	});

	it("declines a size field that does not reach the end of the file", async () => {
		const file = buildPd3([{ name: "A.BIN", data: Buffer.from("payload") }]);
		file.writeUInt32LE(1, 0xc);
		expect(await flyingShinePd3Format.detect(sourceOf(file))).toBe(false);
	});

	it("declines an archive without entries", async () => {
		const file = buildPd3([{ name: "", data: Buffer.alloc(0), empty: true }]);
		expect(await flyingShinePd3Format.detect(sourceOf(file))).toBe(false);
	});

	it("declines an entry outside the file", async () => {
		const file = buildPd3([{ name: "A.BIN", data: Buffer.from("payload") }]);
		file.writeUInt32LE(0x1000, INDEX_OFFSET + 0x10c);
		expect(await flyingShinePd3Format.detect(sourceOf(file))).toBe(false);
	});
});
