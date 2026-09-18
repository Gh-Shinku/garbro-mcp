import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	mebiusMcgImageFormat,
	readMcgLayout,
	unpackMcg,
} from "../../packages/formats/src/mebius/mcg-image.js";

/** A picture: the head and the stream of its own kind. */
function mcgFile(input: {
	width: number;
	height: number;
	method: number;
	stream?: Buffer;
	offsetX?: number;
	offsetY?: number;
	mark?: string;
}): Buffer {
	const head = Buffer.alloc(0x10, 0x00);
	Buffer.from(input.mark ?? "MCG", "latin1").copy(head, 0);
	head.writeUInt8(input.method, 3);
	head.writeInt16BE(input.offsetX ?? 0, 8);
	head.writeInt16BE(input.offsetY ?? 0, 0x0a);
	head.writeUInt16BE(input.width, 0x0c);
	head.writeUInt16BE(input.height, 0x0e);
	return Buffer.concat([head, input.stream ?? Buffer.alloc(0)]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await mebiusMcgImageFormat.open(
		new BufferByteSource(data),
		"pic.mcg",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Mebius image", () => {
	it("reads the head as the reference does", () => {
		const data = mcgFile({
			width: 2,
			height: 1,
			method: 0,
			stream: Buffer.alloc(6),
		});
		expect(readMcgLayout(data)).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 32,
			method: 0,
			stride: 8,
		});
		// The kinds four and five are eight bits of grey a pixel.
		const grey = mcgFile({
			width: 3,
			height: 1,
			method: 5,
			stream: Buffer.alloc(4),
		});
		expect(readMcgLayout(grey)).toMatchObject({
			bitsPerPixel: 8,
			stride: 3,
		});
	});

	it("gates on the mark, the kind, the measurements and the stream", () => {
		const good = mcgFile({
			width: 2,
			height: 1,
			method: 0,
			stream: Buffer.alloc(6),
		});
		expect(readMcgLayout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("MCJ", 0, "latin1");
		expect(readMcgLayout(mark)).toBeUndefined();
		// Only the seven kinds the reference knows are read.
		const method = Buffer.from(good);
		method.writeUInt8(8, 3);
		expect(readMcgLayout(method)).toBeUndefined();
		const width = Buffer.from(good);
		width.writeUInt16BE(0, 0x0c);
		expect(readMcgLayout(width)).toBeUndefined();
		const head = Buffer.from(good.subarray(0, 0x10));
		expect(readMcgLayout(head)).toBeUndefined();
	});

	it("lays three planes into every fourth byte of the row", async () => {
		const data = mcgFile({
			width: 2,
			height: 1,
			method: 0,
			stream: Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
		});
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		expect(out.readInt32LE(0x16)).toBe(1);
		expect(out.subarray(0x36).toString("hex")).toBe("1133550022446600");
	});

	it("hands a picture of the second kind out as it stands", async () => {
		const out = await extract(
			mcgFile({
				width: 2,
				height: 1,
				method: 1,
				stream: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
			}),
		);
		expect(out.subarray(0x36).toString("hex")).toBe("0102030405060708");
	});

	it("unfolds runs of a byte a channel", async () => {
		const data = mcgFile({
			width: 2,
			height: 1,
			method: 2,
			stream: Buffer.from([
				0xff, 0x11, 0xff, 0x01, 0x22, 0x33, 0xff, 0x01, 0x44, 0x55, 0xff, 0x01,
				0x66,
			]),
		});
		const layout = readMcgLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackMcg(data, layout).toString("hex")).toBe("1133550022446600");
	});

	it("keeps the fourth channel of the third kind", async () => {
		const data = mcgFile({
			width: 2,
			height: 1,
			method: 3,
			stream: Buffer.from([
				0xff, 0x11, 0xff, 0x01, 0x22, 0x33, 0xff, 0x01, 0x44, 0x55, 0xff, 0x01,
				0x66, 0x77, 0xff, 0x01, 0x88,
			]),
		});
		const out = await extract(data);
		expect(out.subarray(0x36).toString("hex")).toBe("1133557722446688");
	});

	it("unfolds a run walk of a byte a pixel", async () => {
		const data = mcgFile({
			width: 3,
			height: 1,
			method: 5,
			stream: Buffer.from([0xaa, 0x11, 0xaa, 0x02, 0x22]),
		});
		const layout = readMcgLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackMcg(data, layout).toString("hex")).toBe("112222");
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		expect(out.subarray(0x436, 0x43a).toString("hex")).toBe("11222200");
	});

	it("leaves the picture of the last two kinds as the zeros it began with", async () => {
		const out = await extract(
			mcgFile({
				width: 2,
				height: 1,
				method: 6,
				stream: Buffer.from([1, 2, 3]),
			}),
		);
		expect(out.subarray(0x36).toString("hex")).toBe("0000000000000000");
	});

	it("declines a file that does not hold a picture", async () => {
		const data = mcgFile({ width: 2, height: 1, method: 8 });
		await expect(
			mebiusMcgImageFormat.open(new BufferByteSource(data), "pic.mcg"),
		).rejects.toThrow(GarbroError);
		await expect(
			mebiusMcgImageFormat.open(new BufferByteSource(data), "pic.mcg"),
		).rejects.toThrow("Not a Mebius picture");
	});
});
