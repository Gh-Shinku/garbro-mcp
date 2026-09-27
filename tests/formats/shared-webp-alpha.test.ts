import { GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { readWebpAlpha } from "../../packages/formats/src/shared/webp-alpha.js";
import {
	ALPHA_FILTER_BGRA,
	ALPHA_FILTER_WEBP,
	ALPHA_GRADIENT_BGRA,
	ALPHA_GRADIENT_WEBP,
	ALPHA_LEVEL_BGRA,
	ALPHA_LEVEL_WEBP,
	ALPHA_LOSSLESS_BGRA,
	ALPHA_LOSSLESS_WEBP,
	ALPHA_ODD_BGRA,
	ALPHA_ODD_WEBP,
	ALPHA_VERTICAL_BGRA,
	ALPHA_VERTICAL_WEBP,
	PLACES_BGRA,
	PLACES_WEBP,
} from "../helpers/webp.js";

/** The chunks of a WebP file. */
function chunks(data: Buffer): { type: string; body: Buffer }[] {
	const out: { type: string; body: Buffer }[] = [];
	let at = 12;
	while (at + 8 <= data.length) {
		const type = data.toString("latin1", at, at + 4);
		const size = data.readUInt32LE(at + 4);
		out.push({ type, body: data.subarray(at + 8, at + 8 + size) });
		at += 8 + size + (size & 1);
	}
	return out;
}

function alphaChunk(data: Buffer): Buffer {
	const chunk = chunks(data).find((it) => "ALPH" === it.type);
	if (!chunk) throw new Error("no ALPH chunk");
	return chunk.body;
}

/** The alpha bytes of the BGRA places of the file the reference library wrote. */
function alphaOf(bgra: Buffer): Buffer {
	const out = Buffer.alloc(bgra.length / 4);
	for (let at = 0; at < out.length; at += 1) out[at] = bgra[4 * at + 3] ?? 0;
	return out;
}

/** The fixtures, each naming the storage of the alpha plane and the filter it stands of. The expected alpha bytes are
 * the alpha bytes of the BGRA places of the file the platform library of this machine writes for the whole file, so
 * they come from the reference library and not from the code under test. `ALPHA_VERTICAL_WEBP` and
 * `ALPHA_GRADIENT_WEBP` are built here from the plane of `ALPHA_LOSSLESS_WEBP` (the library of the picture of the web
 * never chooses those two filters by itself) and the library reads them back to the same places of the file as the
 * picture they were built from. */
const CASES: [string, number, number, Buffer, Buffer][] = [
	[
		"4x3, no counts of the head of the format of the picture of the places of the file",
		4,
		3,
		PLACES_WEBP,
		PLACES_BGRA,
	],
	[
		"24x20, counts of the places of the file of the picture of no counts of the places of the file of their own",
		24,
		20,
		ALPHA_LOSSLESS_WEBP,
		ALPHA_LOSSLESS_BGRA,
	],
	[
		"24x20, counts of the head of the format of the picture of the places of the file of the picture of the format standing in front of the picture of the format",
		24,
		20,
		ALPHA_FILTER_WEBP,
		ALPHA_FILTER_BGRA,
	],
	[
		"24x20, counts of the head of the format of the picture of the places of the file of the picture of the format of the counts of the head of the picture of the format",
		24,
		20,
		ALPHA_LEVEL_WEBP,
		ALPHA_LEVEL_BGRA,
	],
	["5x7", 5, 7, ALPHA_ODD_WEBP, ALPHA_ODD_BGRA],
	[
		"24x20, filter of the counts of the head of the format of the picture of the two of them",
		24,
		20,
		ALPHA_VERTICAL_WEBP,
		ALPHA_VERTICAL_BGRA,
	],
	[
		"24x20, filter of the counts of the head of the format of the picture of the places of the file of the picture of the format itself",
		24,
		20,
		ALPHA_GRADIENT_WEBP,
		ALPHA_GRADIENT_BGRA,
	],
];

describe("the places of the file of the colour of the picture of the places of the line", () => {
	for (const [name, width, height, file, bgra] of CASES)
		it(`reads ${name}`, () => {
			expect(
				Buffer.from(readWebpAlpha(alphaChunk(file), width, height)).toString(
					"hex",
				),
			).toBe(alphaOf(bgra).toString("hex"));
		});

	it("stands of no counts of the head of the format of the picture of the places of the file of their own", () => {
		const chunk = Buffer.from(alphaChunk(PLACES_WEBP));
		expect(() => readWebpAlpha(chunk.subarray(0, 1), 4, 3)).toThrow(
			GarbroError,
		);
		expect(() => readWebpAlpha(chunk.subarray(0, 4), 4, 3)).toThrow(
			GarbroError,
		);
		const reserved = Buffer.from(chunk);
		reserved[0] = (reserved[0] ?? 0) | 0x40;
		expect(() => readWebpAlpha(reserved, 4, 3)).toThrow(GarbroError);
		const method = Buffer.from(chunk);
		method[0] = ((method[0] ?? 0) & ~0x03) | 0x02;
		expect(() => readWebpAlpha(method, 4, 3)).toThrow(GarbroError);
		// A raw plane that stands short of the places of the file of the picture, and a lossless stream whose head
		// names counts of the places of the file this walk does not read.
		expect(() =>
			readWebpAlpha(Buffer.from(alphaChunk(PLACES_WEBP)), 5, 3),
		).toThrow(GarbroError);
		const unknown = Buffer.from(alphaChunk(ALPHA_LOSSLESS_WEBP));
		unknown[0] = ((unknown[0] ?? 0) & ~0x03) | 0x03;
		expect(() => readWebpAlpha(unknown, 24, 20)).toThrow(GarbroError);
	});
});
