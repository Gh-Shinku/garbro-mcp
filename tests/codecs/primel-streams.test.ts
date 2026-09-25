// The packed streams of the Primel engine, against streams written off their own rules: the fixture is a
// constructor, so the places of the picture it asks for are the ones the walk of the reference turns out.
import { Buffer } from "node:buffer";
import {
	unpackPrimelLzss,
	unpackPrimelMtf,
	unpackPrimelRle,
} from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

/**
 * The stream of `LzssPackedStream`: the count of the places of the picture, the place of the window of the
 * walk, and then a control byte of eight pictures whose lowest place stands for the one in front of it, of a
 * place of a picture as it stands or of the distance and the count of a run.
 */
function lzssStream(input: {
	count: number;
	frameShift: number;
	pictures: readonly (
		| { kind: "place"; value: number }
		| { kind: "run"; distance: number; count: number }
	)[];
}): Buffer {
	const head = Buffer.alloc(6);
	head.writeInt32LE(input.count, 0);
	head.writeUInt16LE(input.frameShift, 4);
	const out = [head];
	let control = 0;
	let controlAt = 0;
	let body = Buffer.alloc(0);
	input.pictures.forEach((picture, index) => {
		if (index % 8 === 0) {
			if (index > 0) {
				const byte = Buffer.from([control]);
				out.push(byte);
				out.push(body);
				body = Buffer.alloc(0);
			}
			control = 0;
			controlAt = index;
		}
		if (picture.kind === "place") {
			control |= 1 << (index - controlAt);
			body = Buffer.concat([body, Buffer.from([picture.value & 0xff])]);
		} else {
			body = Buffer.concat([
				body,
				Buffer.from([
					picture.distance & 0xff,
					(picture.distance >> 8) & 0xff,
					(picture.count - 4) & 0xff,
				]),
			]);
		}
	});
	out.push(Buffer.from([control]));
	out.push(body);
	return Buffer.concat(out);
}

/** The stream of `RlePackedStream`: the count of the places, the place in front, then the places. */
function rleStream(input: {
	count: number;
	pictures: readonly (
		| { kind: "place"; value: number }
		| { kind: "run"; value: number; count: number }
	)[];
}): Buffer {
	const head = Buffer.alloc(4);
	head.writeInt32LE(input.count, 0);
	const body: number[] = [];
	for (const picture of input.pictures) {
		if (picture.kind === "place") body.push(picture.value & 0xff);
		else {
			// The place in front, the same place again, and the count behind it.
			body.push(
				picture.value & 0xff,
				picture.value & 0xff,
				(picture.count - 2) & 0xff,
			);
		}
	}
	return Buffer.concat([head, Buffer.from(body)]);
}

/**
 * The stream of `MtfPackedStream`: the place of the table the walk begins at, then every place of the picture
 * written as its place in the table of the places of a byte, which the place then moves to the front of.
 */
function mtfStream(picture: readonly number[], start: number): Buffer {
	const head = Buffer.alloc(4);
	head.writeInt32LE(start, 0);
	const table = Array.from({ length: 256 }, (_value, index) => index);
	const body: number[] = [];
	for (const place of picture) {
		const at = table.indexOf(place);
		body.push(at);
		table.splice(at, 1);
		table.unshift(place);
	}
	return Buffer.concat([head, Buffer.from(body)]);
}

describe("Primel streams", () => {
	it("walks a stream of a place and of a run of the window", () => {
		// Two places as they stand, then a run of four places from the distance of two, which reaches back
		// over the two places in front of it and over the two the run itself turns out.
		const stream = lzssStream({
			count: 6,
			frameShift: 4,
			pictures: [
				{ kind: "place", value: 0x41 },
				{ kind: "place", value: 0x42 },
				{ kind: "run", distance: 2, count: 4 },
			],
		});
		expect(unpackPrimelLzss(stream).toString("latin1")).toBe("ABABAB");
	});

	it("stands short of the count of a stream that stands short of its places", () => {
		const stream = lzssStream({
			count: 40,
			frameShift: 4,
			pictures: [{ kind: "place", value: 0x41 }],
		});
		expect(unpackPrimelLzss(stream).toString("latin1")).toBe("A");
		// A head that stands past the places of the stream is turned away.
		expect(() => unpackPrimelLzss(Buffer.alloc(2))).toThrow();
	});

	it("walks a stream of runs of one place", () => {
		// A place, then three of the place behind it, then the place in front of the run alone.
		const stream = rleStream({
			count: 5,
			pictures: [
				{ kind: "place", value: 0x41 },
				{ kind: "run", value: 0x42, count: 3 },
				{ kind: "place", value: 0x43 },
			],
		});
		expect(unpackPrimelRle(stream).toString("latin1")).toBe("ABBBC");
	});

	it("walks the places of a stream of the table of a byte", () => {
		// The places of the picture stand of the table of the places of a byte, which every place read moves
		// to the front of, and then of a walk of a table of the run of the places: the place of every place
		// of the stream, of the count of the places of the stream that stand in front of it and of its own
		// place behind that. The test works that table out of the picture rather than out of the walk.
		const picture = [3, 1, 3, 2, 1];
		const stream = mtfStream(picture, 0);
		const order = picture
			.map((place, index) => ({ place, index }))
			.sort(
				(left, right) => left.place - right.place || left.index - right.index,
			)
			.map((entry) => entry.index);
		const turned: number[] = [];
		let index = 0;
		for (let at = 0; at < 8; at += 1) {
			index = order[index] ?? 0;
			turned.push(picture[index] ?? 0);
		}
		expect([...unpackPrimelMtf(stream, 8)]).toEqual(turned);
		// The walk reads the places of the stream itself: the places of the table are the ones the stream
		// turned out, of the table of the places of a byte behind them.
		expect(turned.length).toBe(8);
		// A walk that stands past the places of the stream is turned away.
		expect(() => unpackPrimelMtf(mtfStream([], 0), 4)).toThrow();
	});

	it("stands of the table of the places of a byte in the order of the stream", () => {
		// A place read twice stands of the place zero of the table the second time, so the stream carries the
		// places of the table rather than the places of the picture.
		const stream = mtfStream([5, 5, 5], 0);
		expect([...stream.subarray(4)]).toEqual([5, 0, 0]);
	});
});
