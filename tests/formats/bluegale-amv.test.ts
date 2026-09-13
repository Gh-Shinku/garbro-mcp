import { BufferByteSource } from "@garbro-mcp/core";
import { blueGaleAmvFormat, decryptZbm, unpackZbm } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const FRAME_START = 0x32;
const BMP_HEADER_SIZE = 0x36;
const ZBM_DESTINATION = 0xe;

/** Packs MSB-first bits the way GARbro's `MsbBitStream` consumes them. */
class MsbBitWriter {
	readonly bytes: number[] = [];
	#bits = 0;
	#count = 0;

	putBit(bit: number): void {
		this.#bits = (this.#bits << 1) | (bit & 1);
		this.#count += 1;
		if (this.#count === 8) {
			this.bytes.push(this.#bits & 0xff);
			this.#bits = 0;
			this.#count = 0;
		}
	}

	put(value: number, length: number): void {
		for (let index = length - 1; index >= 0; index -= 1)
			this.putBit((value >> index) & 1);
	}

	finish(): Buffer {
		if (this.#count > 0) {
			this.bytes.push((this.#bits << (8 - this.#count)) & 0xff);
			this.#bits = 0;
			this.#count = 0;
		}
		return Buffer.from(this.bytes);
	}
}

/** Encodes a payload as literal runs. The reference discards the first bit of the stream. */
function encodeZbmLiterals(content: Buffer): Buffer {
	const writer = new MsbBitWriter();
	writer.putBit(0);
	for (let offset = 0; offset < content.length; offset += 0x7f) {
		const chunk = content.subarray(offset, offset + 0x7f);
		writer.put(chunk.length, 8);
		for (const byte of chunk) writer.put(byte, 8);
	}
	return writer.finish();
}

interface Frame {
	/** Decoded content of the frame's bitmap body. */
	content: Buffer;
}

/** The bitmap the reference synthesizes around every decoded frame. */
function expectedBitmap(content: Buffer): Buffer {
	const output = Buffer.alloc(ZBM_DESTINATION + content.length);
	content.copy(output, ZBM_DESTINATION);
	// The header fields are patched after the body is in place, so the info size reads from it.
	output.write("BM", 0, "ascii");
	output.writeUInt32LE(output.length, 2);
	output.writeUInt32LE(
		output.readUInt32LE(ZBM_DESTINATION) + ZBM_DESTINATION,
		0xa,
	);
	return output;
}

function buildAmv(frames: readonly Frame[]): Buffer {
	const unpackedSize = frames[0]
		? frames[0].content.length - (BMP_HEADER_SIZE - ZBM_DESTINATION)
		: 0;
	const payloads = frames.map((frame) => encodeZbmLiterals(frame.content));
	const header = Buffer.alloc(FRAME_START);
	header.write("ampV", 0, "ascii");
	header.writeInt16LE(1, 4);
	header.writeUInt32LE(unpackedSize, 0x16);
	header.writeUInt32LE(0x140, 0x1a);
	header.writeUInt32LE(0xc0, 0x1e);
	header.writeInt32LE(frames.length, 0x2a);
	return Buffer.concat([
		header,
		...payloads.map((payload) => {
			const size = Buffer.alloc(4);
			size.writeUInt32LE(payload.length, 0);
			return Buffer.concat([size, payload]);
		}),
	]);
}

describe("BlueGale AMPV animation format", () => {
	it("decodes literal runs and matches", () => {
		const content = Buffer.from("ABAB");
		const decoded = Buffer.alloc(content.length);
		unpackZbm(encodeZbmLiterals(content), decoded);
		expect(decoded).toEqual(content);
	});

	it("inverts an obfuscated first hundred bytes", () => {
		const data = Buffer.alloc(0x80, 0x11);
		data[0] = 0x42 ^ 0xff;
		data[1] = 0x4d ^ 0xff;
		decryptZbm(data);
		expect(data[0]).toBe(0x42);
		expect(data[1]).toBe(0x4d);
		expect(data[0x63]).toBe(0xee);
		expect(data[0x64]).toBe(0x11);
	});

	it("reads frames and synthesizes bitmaps", async () => {
		// The decoded body is the unpacked size plus the space behind the bitmap file header.
		const body = Buffer.alloc(0x40, 0x41);
		body.writeUInt32LE(0x28, 0);
		const archive = buildAmv([{ content: body }]);
		await expectArchive({
			format: blueGaleAmvFormat,
			archive,
			sourcePath: "/games/anim.amv",
			metadata: { entryCount: 1, width: 0x140, height: 0xc0 },
			entries: [
				{
					// The synthesized bitmap is the decoded body plus the file header in front of it.
					path: "anim#0000.bmp",
					size: ZBM_DESTINATION + body.length,
					content: expectedBitmap(body),
				},
			],
		});
	});

	it("rejects a foreign signature", async () => {
		const archive = buildAmv([{ content: Buffer.alloc(0x30, 0x41) }]);
		archive.write("XXXX", 0, "ascii");
		const source = new BufferByteSource(archive);
		expect(await blueGaleAmvFormat.detect(source)).toBe(false);
	});

	it("rejects a version other than one", async () => {
		const archive = buildAmv([{ content: Buffer.alloc(0x30, 0x41) }]);
		archive.writeInt16LE(2, 4);
		const source = new BufferByteSource(archive);
		expect(await blueGaleAmvFormat.detect(source)).toBe(false);
	});

	it("rejects a frame that falls outside the archive", async () => {
		const archive = buildAmv([{ content: Buffer.alloc(0x30, 0x41) }]);
		archive.writeUInt32LE(0x1000, FRAME_START);
		const source = new BufferByteSource(archive);
		expect(await blueGaleAmvFormat.detect(source)).toBe(false);
	});
});
