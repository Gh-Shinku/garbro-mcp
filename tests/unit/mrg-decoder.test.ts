import { GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	MrgDecoder,
	rotateByteLeft,
} from "../../packages/formats/src/fc01/mrg-decoder.js";

/**
 * The counts of the cells of a walk of a picture: one cell of the count of the places of the file, the
 * others of nought, of the places of the file of the counts of the picture the other way round where the
 * picture stands of a password of its own.
 */
function countsOf(cell: number, count: number, key = 0): Buffer {
	const counts: Buffer = Buffer.alloc(0x100, 0x00);
	let rolling = key & 0xff;
	for (let place = 0; place < 0x100; place += 1) {
		const wanted = place === cell ? count : 0;
		if (0 === key) {
			counts[place] = wanted;
		} else {
			// The counts of the picture stand of the counts of the file the other way round, of the
			// places of the password of the picture of them.
			for (let candidate = 0; candidate < 0x100; candidate += 1) {
				if ((rotateByteLeft(candidate, 1) ^ rolling) === wanted) {
					counts[place] = candidate;
					break;
				}
			}
		}
		rolling = (rolling - place) & 0xff;
	}
	return counts;
}

/**
 * The walk of the places of a picture: the count of the places of the walk of it of the head of four places
 * of the file, the counts of the cells of the table of it, the places of the code of it and the places of
 * the file of the walk of the counts of them behind it.
 */
function walkOf(counts: Buffer, code: number[], tail = 16): Buffer {
	const head: Buffer = Buffer.alloc(4, 0x00);
	const places: Buffer = Buffer.alloc(4, 0x00);
	for (let at = 0; at < 4; at += 1) {
		places[at] = code[at] ?? 0;
	}
	return Buffer.concat([head, counts, places, Buffer.alloc(tail, 0x00)]);
}

/** The walk of the places of a picture, of the count of the places of the walk of it of the head of it. */
function sizedWalk(counts: Buffer, size: number): Buffer {
	const walk = walkOf(counts, [0, 0, 0, 0]);
	walk.writeUInt32LE(size, 0);
	return walk;
}

describe("MRG decoder", () => {
	it("reads a picture of one cell of the counts of the table of it", () => {
		// One cell of the counts of the table of the walk stands of the count of the places of the file;
		// the places of the code of it stand of nought, of a cell of the table of the counts of them.
		const walk = walkOf(countsOf(0x41, 0xff), [0, 0, 0, 0]);
		const decoder = new MrgDecoder(walk, 4, 8);
		expect(decoder.unpack()).toBe(8);
		expect(decoder.data.toString("latin1")).toBe("AAAAAAAA");
	});

	it("reads a picture of a cell of the counts of the table of it behind the first of them", () => {
		// The counts of the table stand of the cells of them: the first of the places of the file and the
		// count of the places of the file behind it.
		const counts: Buffer = Buffer.alloc(0x100, 0x00);
		counts[0x10] = 1;
		counts[0x90] = 1;
		const walk = walkOf(counts, [0x01, 0x00, 0x00, 0x00]);
		const decoder = new MrgDecoder(walk, 4, 1);
		expect(decoder.unpack()).toBe(1);
		expect([...decoder.data]).toEqual([0x90]);
	});

	it("stands of the counts of the table of the walk of a picture of no count of them", () => {
		const walk = walkOf(Buffer.alloc(0x100, 0x00), [0, 0, 0, 0]);
		const decoder = new MrgDecoder(walk, 4, 4);
		expect(() => decoder.unpack()).toThrow(GarbroError);
	});

	it("stands of the places of the code of a picture beyond the table of the counts of it", () => {
		const walk = walkOf(countsOf(0x41, 0xff), [0xff, 0xff, 0xff, 0xff]);
		const decoder = new MrgDecoder(walk, 4, 4);
		expect(() => decoder.unpack()).toThrow(GarbroError);
	});

	it("reads a picture of the counts of the table of it of a password of its own", () => {
		// The counts of the file stand of the counts of the picture the other way round, of the places of
		// the password of it the same way.
		const counts = countsOf(0x41, 0xff, 0x5a);
		const walk = walkOf(counts, [0, 0, 0, 0]);
		const decoder = new MrgDecoder(walk, 4, 5);
		decoder.resetKey(0x5a);
		expect(decoder.unpack()).toBe(5);
		expect(decoder.data.toString("latin1")).toBe("AAAAA");
	});

	it("reads the words of the head of a walk of a picture", () => {
		// The count of the places of the walk of the picture stands of the two words of the head of it, of
		// the places of the file of the places of the walk the other way round.
		const walk = sizedWalk(countsOf(0x42, 0xff), 3);
		const decoder = MrgDecoder.fromHeader(walk, 0);
		expect(decoder.unpack()).toBe(3);
		expect(decoder.data.toString("latin1")).toBe("BBB");
	});

	it("stands of the places of the walk of a picture where the places of the file stand short of them", () => {
		// Every cell of the counts of the table stands of one place of the file: the walk of the counts of
		// them stands of the places of the file behind it, of no place of the file of the places of it.
		const counts: Buffer = Buffer.alloc(0x100, 0x01);
		const walk = Buffer.concat([counts, Buffer.alloc(4, 0x00)]);
		const decoder = new MrgDecoder(walk, 0, 0x100);
		const written = decoder.unpack();
		expect(written).toBeGreaterThan(0);
		expect(written).toBeLessThan(0x100);
	});
});
