import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { deflateSync } from "node:zlib";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	readRpaIndex,
	renpyRpaFormat,
} from "../../packages/formats/src/renpy/rpa.js";

const INDEX_PLACES = 8;
const KEY_PLACES = 0x19;
const HEAD_SIZE = 0x22;

/** The places of the picture of the walk of the places of the picture of the word of the walk of them of the
 * places of the picture of the walk of the places of the picture of the kind of the places of the picture of
 * the walk of them, the places of the picture of the walk of the places of the picture standing of the places
 * of the picture of the walk of the places of the picture of the place of the picture of the walk of them. */
function pickleInt(value: bigint): number[] {
	if (value >= 0n && value < 0x100n) return [0x4b, Number(value)];
	if (value >= 0n && value < 0x10000n) {
		return [0x4d, Number(value & 0xffn), Number(value >> 8n)];
	}
	if (value >= 0n && value < 0x80000000n) {
		const out = [0x4a];
		for (let i = 0; i < 4; i += 1)
			out.push(Number((value >> BigInt(i * 8)) & 0xffn));
		return out;
	}
	// The places of the picture of the walk of the places of the picture of the walk of them stand as the
	// places of the picture of the walk of the places of the picture of the picture of their own, of the
	// places of the picture of the walk of the places of the picture of the walk of them behind them.
	const bytes: number[] = [];
	let left = value;
	while (left > 0n) {
		bytes.push(Number(left & 0xffn));
		left >>= 8n;
	}
	if (bytes.length === 0) bytes.push(0);
	if (((bytes[bytes.length - 1] ?? 0) & 0x80) !== 0) bytes.push(0);
	return [0x8a, bytes.length, ...bytes];
}

function pickleString(value: string): number[] {
	const bytes = Buffer.from(value, "utf8");
	if (bytes.length > 0xff) throw new Error("name too long");
	return [0x55, bytes.length, ...bytes];
}

/** The places of the picture of the walk of the places of the picture of the words of the walk of the picture
 * of the kind of the places of the picture of the walk of them, standing of the places of the picture of the
 * walk of the places of the picture of the places of the picture of the walk of the places of the picture of
 * the kind of the places of the picture of the walk of them. */
function pickleIndex(
	places: { name: string; offset: bigint; size: bigint; head?: Buffer }[],
): Buffer {
	const out = [0x80, 0x02, 0x7d, 0x28];
	for (const place of places) {
		out.push(...pickleString(place.name), 0x5d);
		out.push(...pickleInt(place.offset));
		out.push(...pickleInt(place.size));
		if (place.head) {
			out.push(0x55, place.head.length, ...place.head);
			out.push(0x87);
		} else {
			out.push(0x86);
		}
		out.push(0x61);
	}
	out.push(0x75, 0x2e);
	return Buffer.from(out);
}

/** The places of the picture of the walk of the places of the picture of the engine of the kind of Ren'Py. */
function archive(options: {
	places: { name: string; offset: bigint; size: bigint; head?: Buffer }[];
	key: number;
	data: Buffer;
	version?: number;
	indexText?: string;
}): Buffer {
	// The places of the picture of the walk of the places of the picture of the place of the picture of the
	// walk of them, and of the places of the picture of the walk of the places of the picture of the place of
	// the picture of the walk of them, stand of the places of the picture of the walk of the places of the
	// picture of the word of the walk of the places of the picture of the head of the picture of the walk of
	// them.
	const index = deflateSync(
		pickleIndex(
			options.places.map((place) => ({
				...place,
				offset: place.offset ^ BigInt(options.key),
				size: place.size ^ BigInt(options.key),
			})),
		),
	);
	const keyText = options.key.toString(16).padStart(8, "0");
	const head = Buffer.alloc(HEAD_SIZE, 0x20);
	head.write("RPA-", 0, "latin1");
	head.writeUInt32LE(options.version ?? 0x20302e33, 4);
	// The places of the picture of the walk of the places of the picture of the words of the walk of the
	// picture stand behind the places of the picture of the walk of the places of the picture of the sound of
	// the picture of the walk of the places of the picture.
	head.write(
		options.indexText ??
			(HEAD_SIZE + options.data.length).toString(16).padStart(16, "0"),
		INDEX_PLACES,
		"latin1",
	);
	head.write(keyText, KEY_PLACES, "latin1");
	return Buffer.concat([head, options.data, index]);
}

describe("Ren'Py archive", () => {
	it("reads the places of the picture of the walk of the places of the picture", async () => {
		const data = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
		const file = archive({
			places: [{ name: "script.rpyc", offset: 0n, size: 8n }],
			key: 0,
			data,
		});
		const places = await readRpaIndex(file, file.length);
		expect(places).toEqual([
			{ path: "script.rpyc", offset: 0, size: 8, head: Buffer.alloc(0) },
		]);
	});

	it("reads the places of the picture of the walk of the places of the picture of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the places of the picture of the walk of the places of the picture", async () => {
		// The places of the picture of the walk of the places of the picture of the place of the picture of the
		// walk of them, and of the places of the picture of the walk of the places of the picture of the place
		// of the picture of the walk of them, stand of the places of the picture of the walk of the places of
		// the picture of the word of the walk of the places of the picture of the head of the picture of the
		// walk of them.
		const key = 0x1a2b3c4d;
		const data = Buffer.from([10, 20, 30, 40, 50, 60, 70, 80]);
		const file = archive({
			places: [
				{ name: "game/script.rpyc", offset: 0n, size: 4n },
				{ name: "game/gui.png", offset: 4n, size: 4n },
			],
			key,
			data,
		});
		const places = await readRpaIndex(file, file.length);
		expect(places).toEqual([
			{ path: "game/script.rpyc", offset: 0, size: 4, head: Buffer.alloc(0) },
			{ path: "game/gui.png", offset: 4, size: 4, head: Buffer.alloc(0) },
		]);
	});

	it("reads the places of the picture of the walk of the places of the picture that stand before the places of the picture of the walk of the places of the picture of the place of the picture of the walk of them", async () => {
		// The places of the picture of the walk of the places of the picture that stand before the places of
		// the picture of the walk of the places of the picture of the place of the picture of the walk of them
		// stand beside the places of the picture of the walk of the places of the picture of the place of the
		// picture of the walk of them of their own.
		const head = Buffer.from([0x78, 0x9c]);
		const data = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee]);
		const file = archive({
			places: [{ name: "pic.rpyc", offset: 0n, size: 7n, head }],
			key: 0,
			data,
		});
		const places = await readRpaIndex(file, file.length);
		expect(places).toEqual([{ path: "pic.rpyc", offset: 0, size: 5, head }]);
	});

	it("reads the places of the picture of the walk of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of more places of the picture than the places of the picture of the walk of the places of the picture of their own", async () => {
		const file = archive({
			places: [{ name: "big.bin", offset: 0n, size: 0x80000010n }],
			key: 0,
			data: Buffer.alloc(4),
		});
		const places = await readRpaIndex(file, file.length);
		expect(places?.[0]?.size).toBe(0x80000010);
	});

	it("turns away the places of the picture of the walk of the places of the picture of no places of the picture of the walk of them", async () => {
		const good = archive({
			places: [{ name: "a.bin", offset: 0n, size: 2n }],
			key: 0,
			data: Buffer.alloc(4),
		});
		expect((await readRpaIndex(good, good.length))?.length).toBe(1);
		const wrongMark = Buffer.from(good);
		wrongMark.write("RPB-", 0, "latin1");
		expect(await readRpaIndex(wrongMark, wrongMark.length)).toBeUndefined();
		const wrongVersion = Buffer.from(good);
		wrongVersion.writeUInt32LE(0x20302e32, 4);
		expect(
			await readRpaIndex(wrongVersion, wrongVersion.length),
		).toBeUndefined();
		const wrongIndex = archive({
			places: [{ name: "a.bin", offset: 0n, size: 2n }],
			key: 0,
			data: Buffer.alloc(4),
			indexText: "zzzzzzzzzzzzzzzz",
		});
		expect(await readRpaIndex(wrongIndex, wrongIndex.length)).toBeUndefined();
		const farIndex = archive({
			places: [{ name: "a.bin", offset: 0n, size: 2n }],
			key: 0,
			data: Buffer.alloc(4),
			indexText: (0x1000).toString(16).padStart(16, "0"),
		});
		expect(await readRpaIndex(farIndex, farIndex.length)).toBeUndefined();
		// The places of the picture of the walk of the places of the picture of the words of the walk of the
		// picture stand of the kind of the places of the picture of the walk of them of no places of the
		// picture of the walk of them.
		const unknown = archive({
			places: [{ name: "a.bin", offset: 0n, size: 2n }],
			key: 0,
			data: Buffer.alloc(4),
		});
		const raw = deflateSync(Buffer.from([0x80, 0x02, 0x99, 0x2e]));
		const cut = Buffer.concat([
			unknown.subarray(0, HEAD_SIZE),
			Buffer.alloc(4),
			raw,
		]);
		await expect(readRpaIndex(cut, cut.length)).rejects.toBeInstanceOf(
			GarbroError,
		);
	});

	it("stands the places of the picture of the walk of the places of the picture out", async () => {
		const data = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
		// The places of the picture of the walk of the places of the picture of the place of the picture of the
		// walk of them stand at the places of the picture of the walk of them of the places of the picture of
		// the walk of the places of the picture of the picture of their own.
		const file = archive({
			places: [
				{ name: "script.rpyc", offset: BigInt(HEAD_SIZE), size: 4n },
				{ name: "gui/logo.png", offset: BigInt(HEAD_SIZE + 4), size: 4n },
			],
			key: 0x1234,
			data,
		});
		const handle = await renpyRpaFormat.open(
			new BufferByteSource(file),
			"game/archive.rpa",
		);
		expect(handle.entries.map((entry) => entry.path)).toEqual([
			"script.rpyc",
			"gui/logo.png",
		]);
		const first = handle.entries[0];
		const second = handle.entries[1];
		if (!first || !second) throw new Error("no entries");
		expect(await consumeBuffer(await handle.openEntry(first.id))).toEqual(
			Buffer.from([1, 2, 3, 4]),
		);
		expect(await consumeBuffer(await handle.openEntry(second.id))).toEqual(
			Buffer.from([5, 6, 7, 8]),
		);
	});

	it("is told by the words of the picture of the walk of the places of the picture", async () => {
		expect(renpyRpaFormat.descriptor.id).toBe("renpy-rpa");
		const file = archive({
			places: [{ name: "a.bin", offset: 0n, size: 2n }],
			key: 0,
			data: Buffer.alloc(4),
		});
		await expect(
			renpyRpaFormat.detect(new BufferByteSource(file)),
		).resolves.toBe(true);
		const wrong = Buffer.from(file);
		wrong.write("RPB-", 0, "latin1");
		await expect(
			renpyRpaFormat.detect(new BufferByteSource(wrong)),
		).resolves.toBe(false);
	});

	it("turns a picture of the places of the picture of no places of the walk of them away", async () => {
		await expect(
			renpyRpaFormat.open(
				new BufferByteSource(Buffer.from("RPA-3.0 ", "latin1")),
				"x.rpa",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
