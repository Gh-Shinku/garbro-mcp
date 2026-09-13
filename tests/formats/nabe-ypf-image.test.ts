import { BufferByteSource } from "@garbro-mcp/core";
import { ypfImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

interface YpfOptions {
	depth?: number;
	width?: number;
	height?: number;
	headerSize?: number;
	body?: Buffer;
}

function buildYpf(options: YpfOptions = {}): Buffer {
	const header: Buffer = Buffer.alloc(options.headerSize ?? 0x10, 0x00);
	if (header.length >= 0x10) {
		header[0] = options.depth ?? 1;
		header.writeUInt32LE(options.width ?? 2, 4);
		header.writeUInt32LE(options.height ?? 1, 8);
	}
	return Buffer.concat([header, options.body ?? Buffer.alloc(0)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.ypf"): Promise<Buffer> {
	const archive = await ypfImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Studio Nabe Bugyou image", () => {
	it("is gated on the file's own extension", async () => {
		const file = buildYpf({ body: Buffer.alloc(6, 0x11) });
		expect(await ypfImageFormat.detect(sourceOf(file), "CG_01.ypf")).toBe(true);
		expect(await ypfImageFormat.detect(sourceOf(file), "CG_01.YPF")).toBe(true);
		// The same bytes under any other name are not this format, because the reference says so.
		expect(await ypfImageFormat.detect(sourceOf(file), "CG_01.dat")).toBe(
			false,
		);
		expect(await ypfImageFormat.detect(sourceOf(file), "CG_01")).toBe(false);
	});

	it("takes the depth byte from the small set it allows", async () => {
		for (const depth of [1, 3]) {
			expect(
				await ypfImageFormat.detect(sourceOf(buildYpf({ depth })), "A.ypf"),
			).toBe(true);
		}
		for (const depth of [0, 2, 4, 0xff]) {
			expect(
				await ypfImageFormat.detect(sourceOf(buildYpf({ depth })), "A.ypf"),
			).toBe(false);
		}
	});

	it("refuses an empty or oversized dimension", async () => {
		for (const options of [
			{ width: 0 },
			{ height: 0 },
			{ width: 0x8001 },
			{ height: 0x8001 },
			{ headline: true, headerSize: 0x0c },
		]) {
			expect(
				await ypfImageFormat.detect(sourceOf(buildYpf(options)), "A.ypf"),
			).toBe(false);
		}
		expect(
			await ypfImageFormat.detect(
				sourceOf(buildYpf({ width: 0x8000, height: 0x8000 })),
				"A.ypf",
			),
		).toBe(true);
	});

	it("hands a twenty four bit image over with its own channel order", async () => {
		const body: Buffer = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
		const output = await extract(
			buildYpf({ depth: 1, width: 2, height: 1, body }),
		);
		expect(output.readUInt16LE(28)).toBe(24);
		// The reference hands this image over unflipped.
		expect(output.readInt32LE(22)).toBe(-1);
		// Six bytes of colour in a row that a bitmap pads to eight.
		expect(output.subarray(54)).toEqual(
			Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x00, 0x00]),
		);
	});

	it("interleaves a thirty two bit image's alpha plane", async () => {
		const colours: Buffer = Buffer.from([0x10, 0x20, 0x30, 0x40, 0x50, 0x60]);
		const alpha: Buffer = Buffer.from([0xaa, 0xbb]);
		const output = await extract(
			buildYpf({
				depth: 3,
				width: 2,
				height: 1,
				body: Buffer.concat([colours, alpha]),
			}),
		);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.subarray(54)).toEqual(
			Buffer.from([0x10, 0x20, 0x30, 0xaa, 0x40, 0x50, 0x60, 0xbb]),
		);
	});

	it("pads what a short file does not hold", async () => {
		// Two pixels at twenty four bits want six bytes and the file has four.
		const output = await extract(
			buildYpf({ depth: 1, width: 2, height: 1, body: Buffer.alloc(4, 0x77) }),
		);
		expect(output.subarray(54)).toEqual(
			Buffer.from([0x77, 0x77, 0x77, 0x77, 0x00, 0x00, 0x00, 0x00]),
		);
		// A thirty two bit image with no alpha plane at all gets a blank one.
		const noAlpha = await extract(
			buildYpf({ depth: 3, width: 1, height: 1, body: Buffer.alloc(3, 0x22) }),
		);
		expect(noAlpha.subarray(54)).toEqual(Buffer.from([0x22, 0x22, 0x22, 0x00]));
	});

	it("names the entry after the bitmap and reports its depth", async () => {
		const archive = await ypfImageFormat.open(
			sourceOf(buildYpf({ depth: 3, width: 4, height: 3 })),
			"sub/CG_02.ypf",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG_02.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 4,
				height: 3,
				bitsPerPixel: 32,
			});
		} finally {
			await archive.close();
		}
	});
});
