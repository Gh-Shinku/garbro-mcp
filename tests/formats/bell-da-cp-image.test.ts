import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	bellDaCpImageFormat,
	cpUnpack,
} from "../../packages/formats/src/bellda/cp-image.js";
import { writeBmp24 } from "../../packages/formats/src/shared/bmp.js";

type Op = ["literal", number] | ["run", number, number];

/** Packs what the reference unfolds: control bits from the highest down, a set bit meaning a literal. */
function cpPack(ops: Op[]): Buffer {
	const chunks: Buffer[] = [];
	for (let start = 0; start < ops.length; start += 8) {
		const group = ops.slice(start, start + 8);
		const payload: Buffer[] = [];
		let control = 0;
		let bit = 0x80;
		for (const op of group) {
			if ("literal" === op[0]) {
				control |= bit;
				payload.push(Buffer.from([op[1]]));
			} else {
				payload.push(
					Buffer.from([
						(op[1] >> 4) & 0xff,
						((op[1] & 0x0f) << 4) | ((op[2] - 2) & 0x0f),
					]),
				);
			}
			bit >>= 1;
		}
		chunks.push(Buffer.from([control]), ...payload);
	}
	return Buffer.concat(chunks);
}

/**
 * A whole file: the tag, and then the packed bitmap, whose **first control byte** is the byte behind the tag
 * that the reference checks the two high bits of.
 */
function cpFile(bitmap: Buffer): Buffer {
	const ops: Op[] = [];
	for (const byte of bitmap) ops.push(["literal", byte]);
	return Buffer.concat([Buffer.from("CP", "latin1"), cpPack(ops)]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await bellDaCpImageFormat.open(
		new BufferByteSource(data),
		"bell.cp",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

const PIXELS = [
	0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
];

describe("BELL-DA compressed bitmap", () => {
	it("finds a bitmap by the tag inside it", async () => {
		const bitmap = writeBmp24(2, 2, Buffer.from(PIXELS));
		const data = cpFile(bitmap);
		expect(
			await bellDaCpImageFormat.detect(new BufferByteSource(data), "bell.cp"),
		).toBe(true);
		// The two high bits of the byte between the tag and the bitmap must be set.
		const odd = Buffer.from(data);
		odd[2] = 0x3f;
		expect(
			await bellDaCpImageFormat.detect(new BufferByteSource(odd), "bell.cp"),
		).toBe(false);
		// And the bitmap behind the stream has to be a bitmap.
		const other = Buffer.from(data);
		other[3] = 0x43;
		expect(
			await bellDaCpImageFormat.detect(new BufferByteSource(other), "bell.cp"),
		).toBe(false);
	});

	it("reports the measurements of the bitmap behind the stream", async () => {
		const data = cpFile(writeBmp24(2, 2, Buffer.from(PIXELS)));
		const handle = await bellDaCpImageFormat.open(
			new BufferByteSource(data),
			"dir/bell.cp",
		);
		expect(handle.entries[0]?.path).toBe("bell.bmp");
		expect(handle.entries[0]?.size).toBe(BigInt(data.length - 2));
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "lzss",
		});
	});

	it("unfolds the bitmap and writes it out again", async () => {
		const bitmap = writeBmp24(2, 2, Buffer.from(PIXELS));
		const out = await extract(cpFile(bitmap));
		expect(out.readUInt16LE(0x1c)).toBe(24);
		expect(out.readInt32LE(0x12)).toBe(2);
		// The rows of the bitmap the fixture wrote stand the right way up.
		expect(out.readInt32LE(0x16)).toBe(-2);
		// Two three byte pixels a row, padded to four.
		expect(out.subarray(0x36).toString("hex")).toBe(
			"01020304050600000708090a0b0c0000",
		);
	});

	it("declines a stream that does not hold a whole bitmap", async () => {
		const bitmap = writeBmp24(2, 2, Buffer.from(PIXELS));
		const data = cpFile(bitmap.subarray(0, 0x30));
		expect(
			await bellDaCpImageFormat.detect(new BufferByteSource(data), "bell.cp"),
		).toBe(false);
		await expect(
			bellDaCpImageFormat.open(new BufferByteSource(data), "bell.cp"),
		).rejects.toThrow(GarbroError);
		await expect(
			bellDaCpImageFormat.open(new BufferByteSource(data), "bell.cp"),
		).rejects.toThrow("Not a BELL-DA bitmap");
	});
});

describe("BELL-DA packed stream", () => {
	it("begins its frame one byte in, where the first literal stands", () => {
		// A run that reads the two bytes behind it finds them one and two places into the frame because the
		// first literal of the stream stands at the first place, not at nothing.
		const out = cpUnpack(
			cpPack([
				["literal", 0x41],
				["literal", 0x42],
				["run", 1, 2],
			]),
			4,
		);
		expect(out.toString("hex")).toBe("41424142");
	});

	it("steps a run forwards, so it may read what it has just written", () => {
		const out = cpUnpack(
			cpPack([
				["literal", 0x11],
				["run", 1, 5],
			]),
			5,
		);
		expect(out.toString("hex")).toBe("1111111111");
	});

	it("takes the count of a run from three to eighteen", () => {
		const out = cpUnpack(cpPack([["run", 0, 17]]), 17);
		expect(out.toString("hex")).toBe("00".repeat(17));
	});

	it("gives up where the stream stops", () => {
		// The control byte promises eight literals and only two follow, so the stream holds two bytes.
		const out = cpUnpack(Buffer.from([0xff, 0x01, 0x02]), 8);
		expect(out.toString("hex")).toBe("0102");
	});
});
