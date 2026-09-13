import { BufferByteSource } from "@garbro-mcp/core";
import { ebisuEp1Format } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const IMAGE_INDEX_START = 8;
const HEADER_SIZE = 0x30;
const NAME_SIZE = 0x20;

interface Entry {
	name: string;
	payload: Buffer;
	width: number;
	height: number;
	method: number;
}

function buildEp1(entries: readonly Entry[]): Buffer {
	const archive = Buffer.alloc(
		IMAGE_INDEX_START +
			entries.reduce(
				(sum, entry) => sum + HEADER_SIZE + entry.payload.length,
				0,
			),
	);
	archive.write("EP1", 0, "ascii");
	let offset = IMAGE_INDEX_START;
	for (const entry of entries) {
		Buffer.from(entry.name, "latin1").copy(archive, offset, 0, NAME_SIZE - 1);
		archive.writeUInt32LE(entry.width, offset + 0x20);
		archive.writeUInt32LE(entry.height, offset + 0x24);
		archive.writeInt32LE(entry.method, offset + 0x28);
		archive.writeUInt32LE(entry.payload.length, offset + 0x2c);
		entry.payload.copy(archive, offset + HEADER_SIZE);
		offset += HEADER_SIZE + entry.payload.length;
	}
	return archive;
}

describe("Studio Ebisu EP1 resource archive", () => {
	it("reads a chain of image records", async () => {
		const first = Buffer.alloc(0x40, 0x11);
		const second = Buffer.alloc(0x20, 0x22);
		const archive = buildEp1([
			{ name: "first.bmp", payload: first, width: 8, height: 8, method: 5 },
			{
				name: "second.bmp",
				payload: second,
				width: 16,
				height: 4,
				method: 0,
			},
		]);
		await expectArchive({
			format: ebisuEp1Format,
			archive,
			metadata: { entryCount: 2 },
			entries: [
				{ path: "first.bmp", size: first.length, content: first },
				{ path: "second.bmp", size: second.length, content: second },
			],
		});
	});

	it("exposes the image geometry and method", async () => {
		const payload = Buffer.alloc(0x30, 0x33);
		const archive = buildEp1([
			{ name: "image.bmp", payload, width: 64, height: 32, method: 7 },
		]);
		const listing = await ebisuEp1Format.open(
			new BufferByteSource(archive),
			"sample.ep1",
		);
		try {
			expect(listing.entries.map((entry) => entry.metadata)).toEqual([
				{ type: "image", width: 64, height: 32, method: 7, bpp: 32 },
			]);
		} finally {
			await listing.close();
		}
	});

	it("stops at the end of the file", async () => {
		const payload = Buffer.from("payload");
		const archive = buildEp1([
			{ name: "only.bmp", payload, width: 2, height: 2, method: 1 },
		]);
		await expectArchive({
			format: ebisuEp1Format,
			archive,
			entries: [{ path: "only.bmp", size: payload.length, content: payload }],
		});
	});

	it("rejects a foreign signature", async () => {
		const archive = buildEp1([
			{
				name: "only.bmp",
				payload: Buffer.from("payload"),
				width: 2,
				height: 2,
				method: 1,
			},
		]);
		archive.write("XXX", 0, "ascii");
		const source = new BufferByteSource(archive);
		expect(await ebisuEp1Format.detect(source)).toBe(false);
	});

	it("rejects a nameless record", async () => {
		const archive = buildEp1([
			{
				name: "only.bmp",
				payload: Buffer.from("payload"),
				width: 2,
				height: 2,
				method: 1,
			},
		]);
		archive.fill(0, IMAGE_INDEX_START, IMAGE_INDEX_START + NAME_SIZE);
		const source = new BufferByteSource(archive);
		expect(await ebisuEp1Format.detect(source)).toBe(false);
	});

	it("rejects a payload that runs past the end of the file", async () => {
		const payload = Buffer.from("payload");
		const archive = buildEp1([
			{ name: "only.bmp", payload, width: 2, height: 2, method: 1 },
		]);
		archive.writeUInt32LE(payload.length + 0x10, IMAGE_INDEX_START + 0x2c);
		const source = new BufferByteSource(archive);
		expect(await ebisuEp1Format.detect(source)).toBe(false);
	});

	it("rejects a trailing header that does not fit", async () => {
		const payload = Buffer.from("payload");
		const archive = buildEp1([
			{ name: "only.bmp", payload, width: 2, height: 2, method: 1 },
		]);
		// Shrink the payload so the walk lands in the middle of the next header.
		archive.writeUInt32LE(payload.length - 4, IMAGE_INDEX_START + 0x2c);
		const source = new BufferByteSource(archive);
		expect(await ebisuEp1Format.detect(source)).toBe(false);
	});
});
