import { BufferByteSource } from "@garbro-mcp/core";
import { malImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from("MICO", "ascii");
const HEADER_SIZE = 0x0e;
const BMP_HEADER_SIZE = 54;
const PALETTE_SIZE = 1024;
const RAW_FLAG = 0x8000;

type Packet = { raw: Buffer } | { repeat: number; value: number };

/** A count above 0x7fff carries raw bytes in its low fifteen bits. */
function emit(packets: Packet[]): Buffer {
	const parts: Buffer[] = [];
	for (const packet of packets) {
		if ("raw" in packet) {
			const header: Buffer = Buffer.alloc(2);
			header.writeUInt16LE(RAW_FLAG | packet.raw.length, 0);
			parts.push(header, packet.raw);
			continue;
		}
		const header: Buffer = Buffer.alloc(2);
		header.writeUInt16LE(packet.repeat, 0);
		parts.push(header, Buffer.from([packet.value & 0xff]));
	}
	return Buffer.concat(parts);
}

function buildMal(options: {
	width: number;
	height: number;
	stream: Buffer;
	marker?: string;
}): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	Buffer.from(options.marker ?? "MSK00", "latin1").copy(header, 4);
	header.writeUInt16LE(options.width, 0x0a);
	header.writeUInt16LE(options.height, 0x0c);
	return Buffer.concat([header, options.stream]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer): Promise<Buffer> {
	const archive = await malImageFormat.open(sourceOf(stored), "MASK.MAL");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

function body(output: Buffer): Buffer {
	return output.subarray(BMP_HEADER_SIZE + PALETTE_SIZE);
}

describe("valkyria mal mask", () => {
	it("declares the MICO signature and no extension", () => {
		expect(malImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(SIGNATURE.toString("latin1")).toBe("MICO");
		expect(malImageFormat.descriptor.extensions).toEqual([]);
	});

	it("reads raw runs and repeated bytes in one stream", async () => {
		// Four by two pixels: three raw bytes, then four of one value, then a raw byte.
		const stream = emit([
			{ raw: Buffer.from([0x11, 0x22, 0x33]) },
			{ repeat: 4, value: 0x44 },
			{ raw: Buffer.from([0x55]) },
		]);
		const stored = buildMal({ width: 4, height: 2, stream });
		const source = sourceOf(stored);
		expect(await malImageFormat.detect(source, "MASK.MAL")).toBe(true);
		const archive = await malImageFormat.open(source, "MASK.MAL");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["MASK.bmp"]);
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "mal-rle",
				width: 4,
				height: 2,
				bitsPerPixel: 8,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(8);
		expect(output.readInt32LE(22)).toBe(-2);
		expect(body(output)).toEqual(
			Buffer.from([0x11, 0x22, 0x33, 0x44, 0x44, 0x44, 0x44, 0x55]),
		);
	});

	it("treats a count of exactly 0x8000 as an empty raw run", async () => {
		// The flag is that the count is above 0x7fff, so 0x8000 is a raw run of no bytes at all.
		const stream = Buffer.concat([
			Buffer.from([0x00, 0x80]),
			emit([{ repeat: 2, value: 0x66 }, { raw: Buffer.from([0x77, 0x88]) }]),
		]);
		const stored = buildMal({ width: 4, height: 1, stream });
		const output = await extract(stored);
		expect(body(output)).toEqual(Buffer.from([0x66, 0x66, 0x77, 0x88]));
	});

	it("consumes a byte for a repeat of zero and writes nothing", async () => {
		const stream = Buffer.concat([
			emit([{ repeat: 0, value: 0x99 }]),
			emit([{ raw: Buffer.from([0x01, 0x02]) }]),
		]);
		const stored = buildMal({ width: 2, height: 1, stream });
		const output = await extract(stored);
		// Two pixels a row pad to four bytes in the bitmap.
		expect(body(output)).toEqual(Buffer.from([0x01, 0x02, 0x00, 0x00]));
	});

	it("allows a repeat to reach into the slack and keeps it out of the image", async () => {
		// A run of six in a four pixel image passes the end by two, which the reference's extra fifteen bytes
		// absorb; only the first four pixels reach the bitmap.
		const stream = emit([{ repeat: 6, value: 0xab }]);
		const stored = buildMal({ width: 4, height: 1, stream });
		const output = await extract(stored);
		expect(body(output)).toEqual(Buffer.from([0xab, 0xab, 0xab, 0xab]));
	});

	it("fails when a repeat reaches past the slack", async () => {
		// Four pixels plus fifteen slack bytes is nineteen, so a run of twenty has nowhere to go.
		const stream = emit([{ repeat: 20, value: 0xcd }]);
		const stored = buildMal({ width: 4, height: 1, stream });
		const source = sourceOf(stored);
		expect(await malImageFormat.detect(source, "MASK.MAL")).toBe(true);
		const archive = await malImageFormat.open(source, "MASK.MAL");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("leaves the rest zero when a raw run runs out of stream", async () => {
		// Eight bytes are announced but only three are stored; the write position still moves by eight.
		const stream = Buffer.from([0x08, 0x80, 0x01, 0x02, 0x03]);
		const stored = buildMal({ width: 4, height: 2, stream });
		const output = await extract(stored);
		expect(body(output)).toEqual(
			Buffer.from([0x01, 0x02, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00]),
		);
	});

	it("fails when the stream ends in the middle of a packet", async () => {
		const stored = buildMal({
			width: 4,
			height: 1,
			stream: Buffer.from([0x03]),
		});
		const archive = await malImageFormat.open(sourceOf(stored), "MASK.MAL");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("declines a wrong marker, a short file and zero dimensions", async () => {
		const stream = emit([{ repeat: 4, value: 0x01 }]);
		const wrongMarker = buildMal({
			width: 4,
			height: 1,
			stream,
			marker: "MSK01",
		});
		expect(await malImageFormat.detect(sourceOf(wrongMarker), "MASK.MAL")).toBe(
			false,
		);
		const stored = buildMal({ width: 4, height: 1, stream });
		expect(
			await malImageFormat.detect(
				sourceOf(stored.subarray(0, HEADER_SIZE - 1)),
				"MASK.MAL",
			),
		).toBe(false);
		const zero = buildMal({ width: 0, height: 1, stream });
		expect(await malImageFormat.detect(sourceOf(zero), "MASK.MAL")).toBe(false);
		// The slack the reference allocates is never part of the image, so the bitmap carries four pixels.
		const output = await extract(stored);
		expect(output.length).toBe(BMP_HEADER_SIZE + PALETTE_SIZE + 4);
	});
});
