import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	malieLibFormat,
	readMalieLibIndex,
} from "../../packages/formats/src/malie/lib.js";

const HEADER_SIZE = 0x10;
const RECORD_SIZE = 0x30;
const NAME_SIZE = 0x24;
const SIZE_OFFSET = NAME_SIZE;
const OFFSET_OFFSET = NAME_SIZE + 4;

interface Place {
	name: string;
	offset: number;
	size: number;
}

function buildLib(places: Place[], data: Buffer, base = 0): Buffer {
	const indexSize = places.length * RECORD_SIZE;
	const out = Buffer.alloc(HEADER_SIZE + indexSize + data.length, 0x00);
	out.write("LIB\0", 0, "latin1");
	out.writeInt16LE(places.length, 8);
	let at = HEADER_SIZE;
	for (const place of places) {
		out.write(place.name, at, "latin1");
		out.writeUInt32LE(place.size, at + SIZE_OFFSET);
		out.writeUInt32LE(place.offset - base, at + OFFSET_OFFSET);
		at += RECORD_SIZE;
	}
	data.copy(out, HEADER_SIZE + indexSize);
	return out;
}

describe("Malie engine resource archive", () => {
	it("reads the places of the picture of the walk of the places of the picture", () => {
		const data = Buffer.from([1, 2, 3, 4, 5, 6]);
		const file = buildLib(
			[
				{ name: "a.txt", offset: HEADER_SIZE + 2 * RECORD_SIZE, size: 4 },
				{ name: "b.bin", offset: HEADER_SIZE + 2 * RECORD_SIZE + 4, size: 2 },
			],
			data,
		);
		const dir = readMalieLibIndex(file);
		expect(dir).toEqual([
			{ path: "a.txt", offset: HEADER_SIZE + 2 * RECORD_SIZE, size: 4 },
			{ path: "b.bin", offset: HEADER_SIZE + 2 * RECORD_SIZE + 4, size: 2 },
		]);
	});

	it("stands the places of the picture of the walk of the places of the picture of a place of the picture of the walk of them that stands for the places of the picture of the walk of the places of the picture of its own", () => {
		const innerData = Buffer.from([0xaa, 0xbb]);
		const inner = buildLib(
			[{ name: "inner.txt", offset: HEADER_SIZE + RECORD_SIZE, size: 2 }],
			innerData,
		);
		const outerIndexSize = RECORD_SIZE;
		const innerOffset = HEADER_SIZE + outerIndexSize;
		const file = buildLib(
			[{ name: "sub", offset: innerOffset, size: inner.length }],
			inner,
		);
		const dir = readMalieLibIndex(file);
		expect(dir).toEqual([
			{
				path: "sub/inner.txt",
				offset: innerOffset + HEADER_SIZE + RECORD_SIZE,
				size: 2,
			},
		]);
	});

	it("reads the places of the picture of the walk of the places of the picture of a place of the picture of the walk of them that stands of no places of the picture of the walk of the places of the picture of the name of the picture of the walk of it of their own", () => {
		const data = Buffer.from([0x11, 0x22, 0x33]);
		const file = buildLib(
			[
				{
					name: "plain",
					offset: HEADER_SIZE + RECORD_SIZE,
					size: 3,
				},
			],
			data,
		);
		const dir = readMalieLibIndex(file);
		expect(dir).toEqual([
			{ path: "plain", offset: HEADER_SIZE + RECORD_SIZE, size: 3 },
		]);
	});

	it("turns away the places of the picture of the walk of the places of the picture of no places of the picture of the walk of them", () => {
		const good = buildLib(
			[{ name: "a.txt", offset: HEADER_SIZE + RECORD_SIZE, size: 1 }],
			Buffer.from([0x01]),
		);
		expect(readMalieLibIndex(good)?.length).toBe(1);
		const wrongMark = Buffer.from(good);
		wrongMark.write("LIb\0", 0, "latin1");
		expect(readMalieLibIndex(wrongMark)).toBeUndefined();
		const noPlaces = Buffer.from(good);
		noPlaces.writeInt16LE(0, 8);
		expect(readMalieLibIndex(noPlaces)).toBeUndefined();
		const manyPlaces = Buffer.from(good);
		manyPlaces.writeInt16LE(0x100, 8);
		expect(readMalieLibIndex(manyPlaces)).toBeUndefined();
		const inside = Buffer.from(good);
		inside.writeUInt32LE(0, HEADER_SIZE + 0x28);
		expect(readMalieLibIndex(inside)).toBeUndefined();
		const past = Buffer.from(good);
		past.writeUInt32LE(0x1000, HEADER_SIZE + 0x28);
		expect(readMalieLibIndex(past)).toBeUndefined();
		const short = Buffer.alloc(4, 0x00);
		short.write("LIB\0", 0, "latin1");
		expect(readMalieLibIndex(short)).toBeUndefined();
	});

	it("stands the places of the picture of the walk of the places of the picture out", async () => {
		const dataOffset = HEADER_SIZE + 2 * RECORD_SIZE;
		const file = buildLib(
			[
				{ name: "a.txt", offset: dataOffset, size: 3 },
				{ name: "b.bin", offset: dataOffset + 3, size: 2 },
			],
			Buffer.from([1, 2, 3, 4, 5]),
		);
		const handle = await malieLibFormat.open(
			new BufferByteSource(file),
			"game/data.lib",
		);
		expect(handle.entries.map((entry) => entry.path)).toEqual([
			"a.txt",
			"b.bin",
		]);
		const first = handle.entries[0];
		const second = handle.entries[1];
		if (!first || !second) throw new Error("no entries");
		expect(await consumeBuffer(await handle.openEntry(first.id))).toEqual(
			Buffer.from([1, 2, 3]),
		);
		expect(await consumeBuffer(await handle.openEntry(second.id))).toEqual(
			Buffer.from([4, 5]),
		);
	});

	it("is told by the words of the picture of the walk of the places of the picture", async () => {
		expect(malieLibFormat.descriptor.id).toBe("malie-lib");
		const file = buildLib(
			[{ name: "a.txt", offset: HEADER_SIZE + RECORD_SIZE, size: 1 }],
			Buffer.from([0x01]),
		);
		await expect(
			malieLibFormat.detect(new BufferByteSource(file)),
		).resolves.toBe(true);
		const wrong = Buffer.from(file);
		wrong.write("LIBU", 0, "latin1");
		await expect(
			malieLibFormat.detect(new BufferByteSource(wrong)),
		).resolves.toBe(false);
	});

	it("turns a picture of the places of the picture of no places of the walk of them away", async () => {
		await expect(
			malieLibFormat.open(
				new BufferByteSource(Buffer.from("LIB\0\0\0\0\0\0\0\0", "latin1")),
				"x.lib",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
