import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { qlieAbmpImageFormat } from "../../packages/formats/src/qlie/abmp-image.js";
import {
	readBmpImage,
	writeBmp24,
	writeBmpImage,
} from "../../packages/formats/src/shared/bmp.js";

const HEADER_SIZE = 0x10;

/** A portable network graphic with nothing but the header a reader reads. */
function pngPayload(width: number, height: number): Buffer {
	const header: Buffer = Buffer.alloc(16 + 13, 0);
	header.set(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 0);
	header.writeUInt32BE(13, 8);
	header.write("IHDR", 12, "latin1");
	header.writeUInt32BE(width, 16);
	header.writeUInt32BE(height, 20);
	header[24] = 8;
	header[25] = 6;
	return header;
}

/** A JPEG whose first marker is the one the reference knows it by, and a frame header behind it. */
function jpegPayload(width: number, height: number): Buffer {
	// The marker, the word of its length, and the fourteen bytes that word leaves room for.
	const app0: Buffer = Buffer.alloc(2 + 2 + 2 + 14, 0);
	app0.writeUInt16BE(0xffd8, 0);
	app0.writeUInt16BE(0xffe0, 2);
	app0.writeUInt16BE(16, 4);
	const frame: Buffer = Buffer.alloc(2 + 2 + 6, 0);
	frame.writeUInt16BE(0xffc0, 0);
	frame.writeUInt16BE(17, 2);
	frame[4] = 8;
	frame.writeUInt16BE(height, 5);
	frame.writeUInt16BE(width, 7);
	frame[9] = 3;
	return Buffer.concat([app0, frame]);
}

/** A bitmap of four times four pixels, whose own header declares the length of the whole of it. */
function bmpPayload(): Buffer {
	return writeBmp24(4, 4, Buffer.alloc(48, 0x33));
}

interface ContainerOptions {
	payload: Buffer;
	/** The length the container declares for the payload, which a bitmap's own header overrides. */
	size?: number;
	magic?: string;
	offset?: number;
}

function abmpFile(options: ContainerOptions): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0);
	header.write(options.magic ?? "ABMP6\0", 0, "latin1");
	const offset = options.offset ?? HEADER_SIZE;
	header.writeUInt32LE(offset - HEADER_SIZE, 0x0c);
	const size: Buffer = Buffer.alloc(4, 0);
	size.writeUInt32LE(options.size ?? options.payload.length, 0);
	return Buffer.concat([header, size, options.payload]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.abmp"): Promise<Buffer> {
	const handle = await qlieAbmpImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("QLIE engine image", () => {
	it("finds a container holding a picture of any of its three kinds", async () => {
		expect(
			await qlieAbmpImageFormat.detect(
				sourceOf(abmpFile({ payload: pngPayload(4, 2) })),
			),
		).toBe(true);
		expect(
			await qlieAbmpImageFormat.detect(
				sourceOf(abmpFile({ payload: jpegPayload(6, 3) })),
			),
		).toBe(true);
		expect(
			await qlieAbmpImageFormat.detect(
				sourceOf(abmpFile({ payload: bmpPayload() })),
			),
		).toBe(true);
	});

	it("declines a container whose name is not its own", async () => {
		expect(
			await qlieAbmpImageFormat.detect(
				sourceOf(abmpFile({ payload: pngPayload(4, 2), magic: "ABMP5\u0000" })),
			),
		).toBe(false);
	});

	it("declines a container holding a word it does not read", async () => {
		const payload: Buffer = Buffer.alloc(29, 0x11);
		payload.write("GIF8", 0, "latin1");
		expect(
			await qlieAbmpImageFormat.detect(sourceOf(abmpFile({ payload }))),
		).toBe(false);
	});

	it("reports what the picture behind the header says about itself", async () => {
		const handle = await qlieAbmpImageFormat.open(
			sourceOf(abmpFile({ payload: jpegPayload(6, 3) })),
			"dir/cg.abmp",
		);
		expect(handle.entries[0]?.path).toBe("cg.jpg");
		expect(handle.entries[0]?.metadata).toMatchObject({
			type: "image",
			width: 6,
			height: 3,
			bitsPerPixel: 24,
			payloadFormat: "jpeg",
		});
		expect(handle.metadata).toMatchObject({
			image: "jpg",
			width: 6,
			height: 3,
		});
	});

	it("hands a portable network graphic over as it is", async () => {
		const payload = pngPayload(5, 7);
		const out = await extract(abmpFile({ payload }));
		expect(out).toEqual(payload);
		const handle = await qlieAbmpImageFormat.open(
			sourceOf(abmpFile({ payload })),
			"cg.abmp",
		);
		expect(handle.entries[0]?.path).toBe("cg.png");
	});

	it("hands a jpeg over as it is", async () => {
		const payload = jpegPayload(9, 2);
		expect(await extract(abmpFile({ payload }))).toEqual(payload);
	});

	it("writes a bitmap behind the container as a bitmap of its own", async () => {
		const payload = bmpPayload();
		const image = readBmpImage(payload);
		if (!image) throw new Error("the fixture is not a bitmap");
		expect(await extract(abmpFile({ payload }))).toEqual(writeBmpImage(image));
	});

	it("takes the length of a bitmap from the bitmap itself", async () => {
		// The container declares four bytes where the bitmap declares the whole of itself, which wins.
		const payload = bmpPayload();
		const out = await extract(abmpFile({ payload, size: 4 }));
		const image = readBmpImage(payload);
		if (!image) throw new Error("the fixture is not a bitmap");
		expect(out).toEqual(writeBmpImage(image));
	});

	it("refuses a container with no picture behind it", async () => {
		const data = abmpFile({ payload: Buffer.alloc(0), size: 0 });
		await expect(extract(data)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});
});
