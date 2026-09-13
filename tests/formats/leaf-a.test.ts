import { BufferByteSource } from "@garbro-mcp/core";
import { leafAFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const SIGNATURE = 0xaf1e;
const RECORD_SIZE = 0x20;
const NAME_SIZE = 0x17;

interface Entry {
	name: string;
	key: number;
	/** Payload as stored: a raw blob, or a four-byte size plus an LZSS stream. */
	stored: Buffer;
	/** Declared unpacked size for packed entries. */
	unpacked?: number;
}

function buildA(entries: readonly Entry[]): Buffer {
	const indexEnd = 4 + entries.length * RECORD_SIZE;
	const archive = Buffer.alloc(
		indexEnd + entries.reduce((sum, entry) => sum + entry.stored.length, 0),
	);
	archive.writeUInt16LE(SIGNATURE, 0);
	archive.writeUInt16LE(entries.length, 2);
	let offset = indexEnd;
	for (const [id, entry] of entries.entries()) {
		const record = 4 + id * RECORD_SIZE;
		Buffer.from(entry.name, "latin1").copy(archive, record, 0, NAME_SIZE);
		archive[record + 0x17] = entry.key;
		archive.writeUInt32LE(entry.stored.length, record + 0x18);
		archive.writeUInt32LE(offset - indexEnd, record + 0x1c);
		entry.stored.copy(archive, offset);
		offset += entry.stored.length;
	}
	return archive;
}

/** A packed record: four-byte unpacked size followed by the LZSS stream. */
function packedPayload(content: Buffer): Buffer {
	const prefix = Buffer.alloc(4);
	prefix.writeUInt32LE(content.length, 0);
	return Buffer.concat([prefix, literalLzssStream(content)]);
}

/** Builds a 32-bit BGRA image whose pixels are pre-multiplied by their alpha values. */
function buildImage(width: number, height: number): Buffer {
	const image = Buffer.alloc(0x20 + width * height * 4);
	image.writeUInt32LE(width, 0);
	image.writeUInt32LE(height, 4);
	image.writeUInt16LE(1, 0x10);
	image.writeUInt16LE(0x20, 0x12);
	return image;
}

describe("Leaf A resource archive", () => {
	it("reads records and decodes packed entries", async () => {
		const raw = Buffer.from("plain entry payload");
		const unpacked = Buffer.from("lzss compressed entry payload");
		const archive = buildA([
			{ name: "raw.bin", key: 0, stored: raw },
			{
				name: "packed.dat",
				key: 1,
				stored: packedPayload(unpacked),
				unpacked: unpacked.length,
			},
		]);
		await expectArchive({
			format: leafAFormat,
			archive,
			metadata: { entryCount: 2 },
			entries: [
				{ path: "raw.bin", size: raw.length, content: raw },
				{ path: "packed.dat", size: unpacked.length, content: unpacked },
			],
		});
	});

	it("un-premultiplies alpha for keys between 0x7f and 0x89", async () => {
		const image = buildImage(2, 1);
		// Two pre-multiplied pixels written as BGRA with alpha values 0x10 and 0x20.
		image[0x20] = 0x05;
		image[0x21] = 0x06;
		image[0x22] = 0x07;
		image[0x23] = 0x10;
		image[0x24] = 0x0a;
		image[0x25] = 0x0b;
		image[0x26] = 0x0c;
		image[0x27] = 0x20;
		const archive = buildA([
			{
				name: "frame.leaf",
				key: 0x81,
				stored: packedPayload(image),
				unpacked: image.length,
			},
		]);
		const expected = Buffer.from(image);
		// Accumulators start at zero and subtract the key nibble (0x81 & 0xF == 1).
		const key = 0x81 & 0xf;
		let red = 0;
		let green = 0;
		let blue = 0;
		for (let position = 0x20; position < expected.length; position += 4) {
			const alpha = image[position + 3] ?? 0;
			blue = (blue + (image[position] ?? 0) + alpha - key) & 0xff;
			green = (green + (image[position + 1] ?? 0) + alpha - key) & 0xff;
			red = (red + (image[position + 2] ?? 0) + alpha - key) & 0xff;
			expected[position] = blue;
			expected[position + 1] = green;
			expected[position + 2] = red;
			expected[position + 3] = 0;
		}
		await expectArchive({
			format: leafAFormat,
			archive,
			entries: [{ path: "frame.leaf", size: image.length, content: expected }],
		});
	});

	it("leaves the fix-up alone for keys outside the range", async () => {
		const image = buildImage(1, 1);
		image[0x20] = 1;
		image[0x21] = 2;
		image[0x22] = 3;
		image[0x23] = 4;
		const archive = buildA([
			{
				name: "frame.leaf",
				key: 0x0a,
				stored: packedPayload(image),
				unpacked: image.length,
			},
		]);
		await expectArchive({
			format: leafAFormat,
			archive,
			entries: [{ path: "frame.leaf", size: image.length, content: image }],
		});
	});

	it("rejects a foreign signature", async () => {
		const archive = buildA([
			{ name: "raw.bin", key: 0, stored: Buffer.from("payload") },
		]);
		archive.writeUInt16LE(0x1234, 0);
		const source = new BufferByteSource(archive);
		expect(await leafAFormat.detect(source)).toBe(false);
	});

	it("rejects an entry placed outside the archive", async () => {
		const archive = buildA([
			{ name: "raw.bin", key: 0, stored: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(0x1000, 4 + 0x1c);
		const source = new BufferByteSource(archive);
		expect(await leafAFormat.detect(source)).toBe(false);
	});
});
