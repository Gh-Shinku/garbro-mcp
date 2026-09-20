import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	iarDefaultName,
	readIarIndex,
	sas5IarFormat,
} from "../../packages/formats/src/sas5/iar.js";

const FIRST_OFFSET = 0x20;

function buildIar(options: {
	version: number;
	fileCount: number;
	count: number;
	offsets: number[];
	dataOffset: number;
	data: Buffer;
}): Buffer {
	const offsetSize = options.version < 3 ? 4 : 8;
	const out = Buffer.alloc(options.dataOffset + options.data.length, 0x00);
	out.write("iar ", 0, "latin1");
	out.writeInt16LE(options.version, 4);
	out.writeInt32LE(options.fileCount, 0x18);
	out.writeInt32LE(options.count, 0x1c);
	let at = FIRST_OFFSET;
	for (const offset of options.offsets) {
		if (offsetSize === 4) out.writeUInt32LE(offset, at);
		else out.writeBigInt64LE(BigInt(offset), at);
		at += offsetSize;
	}
	options.data.copy(out, options.dataOffset);
	return out;
}

describe("SAS5 engine images archive", () => {
	it("reads the places of the picture of the walk of the places of the picture", () => {
		const file = buildIar({
			version: 1,
			fileCount: 2,
			count: 3,
			offsets: [0x30, 0x34, 0x38],
			dataOffset: 0x30,
			data: Buffer.from([
				1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
			]),
		});
		const index = readIarIndex(file, file.length, "data");
		expect(index?.version).toBe(1);
		expect(index?.fileCount).toBe(2);
		expect(index?.entries).toEqual([
			{ path: "data#00000", offset: 0x30, size: 4 },
			{ path: "data#00001", offset: 0x34, size: 4 },
			{ path: "data#00002", offset: 0x38, size: 8 },
		]);
	});

	it("stands the places of the picture of the walk of the places of the picture of the third kind of the walk of the places of the picture", () => {
		const file = buildIar({
			version: 3,
			fileCount: 1,
			count: 2,
			offsets: [0x30, 0x34],
			dataOffset: 0x30,
			data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
		});
		const index = readIarIndex(file, file.length, "cg");
		expect(index?.version).toBe(3);
		expect(index?.entries).toEqual([
			{ path: "cg#00000", offset: 0x30, size: 4 },
			{ path: "cg#00001", offset: 0x34, size: 4 },
		]);
	});

	it("stands the places of the picture of the walk of the places of the picture of the name of the picture of the walk of it of its own", () => {
		expect(iarDefaultName("data", 0)).toBe("data#00000");
		expect(iarDefaultName("data", 12345)).toBe("data#12345");
		expect(iarDefaultName("data", 7)).toBe("data#00007");
	});

	it("turns away the places of the picture of the walk of the places of the picture of no places of the picture of the walk of them", () => {
		const good = buildIar({
			version: 1,
			fileCount: 1,
			count: 2,
			offsets: [0x28, 0x2c],
			dataOffset: 0x28,
			data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
		});
		expect(readIarIndex(good, good.length)?.entries.length).toBe(2);
		const wrongMark = Buffer.from(good);
		wrongMark.write("IAR ", 0, "latin1");
		expect(readIarIndex(wrongMark, wrongMark.length)).toBeUndefined();
		for (const version of [0, 5, -1]) {
			const bad = Buffer.from(good);
			bad.writeInt16LE(version, 4);
			expect(readIarIndex(bad, bad.length)).toBeUndefined();
		}
		const fewFiles = Buffer.from(good);
		fewFiles.writeInt32LE(3, 0x18);
		expect(readIarIndex(fewFiles, fewFiles.length)).toBeUndefined();
		const noPlaces = Buffer.from(good);
		noPlaces.writeInt32LE(0, 0x1c);
		expect(readIarIndex(noPlaces, noPlaces.length)).toBeUndefined();
		const backwards = Buffer.from(good);
		backwards.writeUInt32LE(0x30, FIRST_OFFSET);
		expect(readIarIndex(backwards, backwards.length)).toBeUndefined();
		const past = Buffer.from(good);
		past.writeUInt32LE(0x1000, FIRST_OFFSET);
		expect(readIarIndex(past, past.length)).toBeUndefined();
		const cutTable = Buffer.alloc(FIRST_OFFSET + 4, 0x00);
		cutTable.write("iar ", 0, "latin1");
		cutTable.writeInt16LE(1, 4);
		cutTable.writeInt32LE(4, 0x1c);
		expect(readIarIndex(cutTable, cutTable.length)).toBeUndefined();
		expect(readIarIndex(Buffer.alloc(4), 4)).toBeUndefined();
	});

	it("stands the places of the picture of the walk of the places of the picture out", async () => {
		const file = buildIar({
			version: 1,
			fileCount: 1,
			count: 2,
			offsets: [0x28, 0x2c],
			dataOffset: 0x28,
			data: Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]),
		});
		const handle = await sas5IarFormat.open(
			new BufferByteSource(file),
			"game/cg.iar",
		);
		expect(handle.entries.map((entry) => entry.path)).toEqual([
			"cg#00000",
			"cg#00001",
		]);
		const first = handle.entries[0];
		const second = handle.entries[1];
		if (!first || !second) throw new Error("no entries");
		expect(await consumeBuffer(await handle.openEntry(first.id))).toEqual(
			Buffer.from([0x11, 0x22, 0x33, 0x44]),
		);
		expect(await consumeBuffer(await handle.openEntry(second.id))).toEqual(
			Buffer.from([0x55, 0x66, 0x77, 0x88]),
		);
	});

	it("is told by the words of the picture of the walk of the places of the picture", async () => {
		expect(sas5IarFormat.descriptor.id).toBe("sas5-iar");
		const file = buildIar({
			version: 1,
			fileCount: 1,
			count: 1,
			offsets: [0x24],
			dataOffset: 0x24,
			data: Buffer.from([1, 2, 3, 4]),
		});
		await expect(
			sas5IarFormat.detect(new BufferByteSource(file)),
		).resolves.toBe(true);
		const wrong = Buffer.from(file);
		wrong.write("IAR ", 0, "latin1");
		await expect(
			sas5IarFormat.detect(new BufferByteSource(wrong)),
		).resolves.toBe(false);
	});

	it("turns a picture of the places of the picture of no places of the walk of them away", async () => {
		await expect(
			sas5IarFormat.open(
				new BufferByteSource(Buffer.from("iar \0\0\0\0", "latin1")),
				"x.iar",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
