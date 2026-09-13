import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { lunePackFormat } from "../../packages/formats/src/lune/pack.js";

interface PackEntry {
	offset: number;
	size: number;
}

/**
 * Builds a Lune Adv Game archive. The index doubles as the record table: the first field is the
 * offset of the payload area, which is also the first record's offset, and the count is that field
 * divided by the record size. A null payload stores a zero sized record.
 */
function buildPack(
	payloads: { data: Buffer | null; slot?: number }[],
	options: { firstOffset?: number } = {},
): Buffer {
	const count =
		options.firstOffset === undefined
			? payloads.reduce(
					(highest, payload) => Math.max(highest, (payload.slot ?? 0) + 1),
					payloads.length,
				)
			: Math.max(1, Math.floor((options.firstOffset ?? 0) / 8));
	const firstOffset = options.firstOffset ?? count * 8;
	let position = firstOffset;
	const bodies: Buffer[] = [];
	const slots: (PackEntry | undefined)[] = new Array(count).fill(undefined);
	for (const [index, payload] of payloads.entries()) {
		const slot = payload.slot ?? index;
		const data = payload.data ?? Buffer.alloc(0);
		slots[slot] = { offset: position, size: data.length };
		position += data.length;
		if (data.length > 0) bodies.push(data);
	}
	const index = Buffer.alloc(firstOffset);
	for (const [slot, record] of slots.entries()) {
		if (!record) continue;
		index.writeUInt32LE(record.offset, slot * 8);
		index.writeUInt32LE(record.size, slot * 8 + 4);
	}
	return Buffer.concat([index, ...bodies]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("lune adv game pack", () => {
	it("declines a single record archive", async () => {
		// The first offset doubles as the first record offset, so a one record index reads as eight.
		const file = buildPack([{ data: Buffer.from("payload") }]);
		expect(await lunePackFormat.detect(sourceOf(file), "game.dat")).toBe(false);
	});

	it("declines an index that is not aligned to the record size", async () => {
		const file = buildPack([{ data: Buffer.from("payload") }], {
			firstOffset: 12,
		});
		expect(await lunePackFormat.detect(sourceOf(file), "game.dat")).toBe(false);
	});

	it("declines an entry that starts before the index", async () => {
		const file = buildPack([
			{ data: Buffer.from("payload") },
			{ data: Buffer.from("more") },
		]);
		// The second record starts at byte eight, right after the first offset field.
		file.writeUInt32LE(0, 8);
		expect(await lunePackFormat.detect(sourceOf(file), "game.dat")).toBe(false);
	});

	it("declines a file whose last entry ends before the end", async () => {
		const file = Buffer.concat([
			buildPack([{ data: Buffer.from("payload") }]),
			Buffer.from("tail"),
		]);
		expect(await lunePackFormat.detect(sourceOf(file), "game.dat")).toBe(false);
	});

	it("lists entries named after the file and extracts them", async () => {
		const first = Buffer.from("first");
		const second = Buffer.from("second payload");
		const file = buildPack([{ data: first }, { data: second }]);
		const source = sourceOf(file);
		expect(await lunePackFormat.detect(source, "game.dat")).toBe(true);
		const archive = await lunePackFormat.open(source, "game.dat");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"game#00000",
				"game#00001",
			]);
			expect(archive.entries.map((entry) => Number(entry.size))).toEqual([
				first.length,
				second.length,
			]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "image" });
			const entry = archive.entries[1];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				second,
			);
		} finally {
			await archive.close();
		}
	});

	it("uses the extension as the base name for a pack archive", async () => {
		const file = buildPack([
			{ data: Buffer.from("data") },
			{ data: Buffer.from("more") },
		]);
		const source = sourceOf(file);
		const archive = await lunePackFormat.open(source, "pack.dat");
		try {
			expect(archive.entries[0]?.path).toBe("dat#00000");
		} finally {
			await archive.close();
		}
	});

	it("marks script archives as scripts", async () => {
		const file = buildPack([
			{ data: Buffer.from("script") },
			{ data: Buffer.from("body") },
		]);
		const source = sourceOf(file);
		const archive = await lunePackFormat.open(source, "scenario.scr");
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "script" });
			expect(archive.metadata).toMatchObject({ type: "script" });
		} finally {
			await archive.close();
		}
	});

	it("skips zero sized records but keeps their index slots", async () => {
		const first = Buffer.from("first");
		const second = Buffer.from("second");
		const file = buildPack([
			{ data: first },
			{ data: null },
			{ data: second, slot: 2 },
		]);
		const source = sourceOf(file);
		const archive = await lunePackFormat.open(source, "game.dat");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"game#00000",
				"game#00002",
			]);
			expect(archive.entries[1]?.sizeKnown).toBeUndefined();
		} finally {
			await archive.close();
		}
	});

	it("wraps wda audio in a riff header", async () => {
		const data = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
		// The zero sized record has to sit inside the file, so it comes before the payload.
		const file = buildPack([{ data: null }, { data }]);
		const source = sourceOf(file);
		const archive = await lunePackFormat.open(source, "sound.wda");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.metadata).toMatchObject({
				type: "audio",
				sampleRate: 22050,
			});
			expect(entry.sizeKnown).toBe(false);
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(44 + data.length);
			expect(output.toString("latin1", 0, 4)).toBe("RIFF");
			expect(output.readUInt32LE(4)).toBe(0x24 + data.length);
			expect(output.toString("latin1", 8, 12)).toBe("WAVE");
			expect(output.readUInt16LE(0x14)).toBe(1);
			expect(output.readUInt16LE(0x16)).toBe(1);
			expect(output.readUInt32LE(0x18)).toBe(22050);
			expect(output.readUInt32LE(0x1c)).toBe(44100);
			expect(output.readUInt16LE(0x20)).toBe(2);
			expect(output.readUInt16LE(0x22)).toBe(16);
			expect(output.toString("latin1", 0x24, 0x28)).toBe("data");
			expect(output.readUInt32LE(0x28)).toBe(data.length);
			expect(output.subarray(44)).toEqual(data);
		} finally {
			await archive.close();
		}
	});

	it("uses a higher sample rate for bgm audio", async () => {
		const file = buildPack([
			{ data: Buffer.from([0, 1, 2, 3]) },
			{ data: Buffer.from([4, 5]) },
		]);
		const source = sourceOf(file);
		const archive = await lunePackFormat.open(source, "theme.bgm");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.metadata).toMatchObject({ sampleRate: 44100 });
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt32LE(0x18)).toBe(44100);
			expect(output.readUInt32LE(0x1c)).toBe(88200);
		} finally {
			await archive.close();
		}
	});
});
