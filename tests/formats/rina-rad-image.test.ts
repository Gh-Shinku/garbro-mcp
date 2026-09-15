import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	rinaRadImageFormat,
	unpackRadAlpha,
} from "../../packages/formats/src/rina/rad-image.js";

const RGB_LENGTH = 640 * 480 * 3;
const ALPHA_LENGTH = 640 * 480;

/** Packs the plane of colour the way the reference unfolds it: three bytes, or nothing and a count. */
class RadWriter {
	private readonly chunks: Buffer[] = [];

	literal(red: number, green: number, blue: number): this {
		this.chunks.push(Buffer.from([red, green, blue]));
		return this;
	}

	skip(count: number): this {
		this.chunks.push(Buffer.from([0x00, 0x00, 0x00, count]));
		return this;
	}

	build(): Buffer {
		return Buffer.concat(this.chunks);
	}
}

function radFile(kind: string, body: Buffer): Buffer {
	return Buffer.concat([Buffer.from(`${kind}\0`, "latin1"), body]);
}

function plane(fill: number): Buffer {
	return Buffer.alloc(RGB_LENGTH, fill);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await rinaRadImageFormat.open(
		new BufferByteSource(data),
		"angel.rad",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Rina engine image format", () => {
	it("tells its two signatures apart", async () => {
		const body = Buffer.alloc(6, 0x11);
		expect(
			await rinaRadImageFormat.detect(
				new BufferByteSource(radFile("RA0", body)),
				"angel.rad",
			),
		).toBe(true);
		expect(
			await rinaRadImageFormat.detect(
				new BufferByteSource(radFile("RAD", body)),
				"angel.rad",
			),
		).toBe(true);
		// The fourth byte of the signature must be nothing.
		const odd = radFile("RA0", body);
		odd[3] = 0x01;
		expect(
			await rinaRadImageFormat.detect(new BufferByteSource(odd), "angel.rad"),
		).toBe(false);
	});

	it("reports the one size its pictures have", async () => {
		const handle = await rinaRadImageFormat.open(
			new BufferByteSource(radFile("RA0", Buffer.alloc(8, 0x00))),
			"dir/angel.rad",
		);
		expect(handle.entries[0]?.path).toBe("angel.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 640,
			height: 480,
			bitsPerPixel: 24,
			compressed: true,
		});
		const other = await rinaRadImageFormat.open(
			new BufferByteSource(radFile("RAD", Buffer.alloc(8, 0x00))),
			"angel.rad",
		);
		expect(other.entries[0]?.metadata).toMatchObject({ compressed: false });
	});

	it("hands out a picture that stands as it is, with its rows the other way up", async () => {
		const pixels = plane(0x00);
		pixels[0] = 0x01;
		pixels[1] = 0x02;
		pixels[2] = 0x03;
		const out = await extract(radFile("RAD", pixels));
		expect(out.readUInt16LE(0x1c)).toBe(24);
		expect(out.readInt32LE(0x12)).toBe(640);
		// A positive height stands for rows that begin at the bottom.
		expect(out.readInt32LE(0x16)).toBe(480);
		expect(out.subarray(0x36, 0x39).toString("hex")).toBe("010203");
	});

	it("unfolds a packed picture, with the pixels a count skips left at nothing", async () => {
		const body = new RadWriter()
			.literal(0x0a, 0x0b, 0x0c)
			.skip(2)
			.literal(0x0d, 0x0e, 0x0f)
			.build();
		const out = await extract(radFile("RA0", body));
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// The first pixel, then a pixel of nothing and the two the count carries the reader past, then the
		// last pixel nine bytes in.
		expect(out.subarray(0x36, 0x36 + 18).toString("hex")).toBe(
			"0a0b0c0000000000000d0e0f000000000000",
		);
	});

	it("weaves the plane of transparency into a picture that carries one", async () => {
		const pixels = plane(0x00);
		pixels[0] = 0x11;
		pixels[1] = 0x22;
		pixels[2] = 0x33;
		pixels[3] = 0x44;
		pixels[4] = 0x55;
		pixels[5] = 0x66;
		const alpha: Buffer = Buffer.alloc(ALPHA_LENGTH, 0x00);
		alpha[0] = 0x80;
		alpha[1] = 0x90;
		const out = await extract(radFile("RAD", Buffer.concat([pixels, alpha])));
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(out.readUInt32LE(0x0a)).toBe(0x36);
		expect(out.subarray(0x36, 0x36 + 8).toString("hex")).toBe(
			"1122338044556690",
		);
	});

	it("reads the plane of transparency a packed picture carries the same way", async () => {
		// A packed picture that is full — each run a pixel of nothing and the two hundred and fifty five pixels
		// it carries the reader past — behind which the plane of transparency is packed the same way.
		const runs: Buffer[] = [];
		for (let index = 0; index < 1205; index += 1) {
			runs.push(Buffer.from([0x00, 0x00, 0x00, 0xff]));
		}
		const alpha = Buffer.from([0x40, 0xff, 0x80, 0x00]);
		const out = await extract(radFile("RA0", Buffer.concat([...runs, alpha])));
		expect(out.readUInt16LE(0x1c)).toBe(32);
		// The colour plane is all nothing; the first two hundred and fifty five pixels of transparency carry
		// the first value, and the picture is handed out with four bytes a pixel from there on.
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("0000004000000040");
		expect(
			out.subarray(0x36 + 255 * 4, 0x36 + 255 * 4 + 4).toString("hex"),
		).toBe("00000000");
	});

	it("leaves the picture at nothing where a packed stream gives up", async () => {
		const body = new RadWriter().literal(0x0a, 0x0b, 0x0c).build();
		const out = await extract(radFile("RA0", body));
		expect(out.readUInt16LE(0x1c)).toBe(24);
		expect(out.subarray(0x36, 0x36 + 12).toString("hex")).toBe(
			"0a0b0c000000000000000000",
		);
	});

	it("takes a stream that stops in the middle of a triple as one without transparency", async () => {
		// The byte behind the triple is taken into the read, which finds a single byte where it wants three and
		// gives up; the stream stands at its end, so the picture is handed out with three bytes a pixel.
		const body = new RadWriter().literal(0x0a, 0x0b, 0x0c).build();
		const out = await extract(
			radFile("RA0", Buffer.concat([body, Buffer.from([0x80])])),
		);
		expect(out.readUInt16LE(0x1c)).toBe(24);
	});
});

describe("Rina engine transparency runs", () => {
	it("holds a count that runs past the picture to what is left of it", () => {
		const pairs: Buffer[] = [];
		for (let index = 0; index < 1205; index += 1) {
			pairs.push(Buffer.from([0x33, 0xff]));
		}
		const alpha = unpackRadAlpha(Buffer.concat(pairs), 0);
		expect(alpha.length).toBe(ALPHA_LENGTH);
		expect(alpha[0]).toBe(0x33);
		// Twelve hundred and four pairs cover three hundred and seven thousand and twenty bytes, and the last
		// one is held to the hundred and eighty that are left.
		expect(alpha[ALPHA_LENGTH - 1]).toBe(0x33);
	});

	it("drops a pair the stream stops in the middle of", () => {
		const alpha = unpackRadAlpha(
			Buffer.from([0x11, 0x02, 0x22, 0x00, 0x33]),
			0,
		);
		// The pair of nothing carries nothing, and the pair the stream stops inside of is dropped.
		expect(alpha.subarray(0, 4).toString("hex")).toBe("11110000");
	});
});
