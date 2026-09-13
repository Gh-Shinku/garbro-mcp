import { BufferByteSource } from "@garbro-mcp/core";
import { triangleBmxFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const OFFSET_BIAS = 8;
const SIZE_MASK = 0x65641538;

interface Entry {
	payload: Buffer;
	unpackedSize?: number;
}

/** A Triangle LZ stream with three literals, two overlapping matches, and no trailing data. */
function triLzFixture(): { stream: Buffer; output: Buffer } {
	const literals = [0x41, 0x42, 0x43];
	let key = 0x7f;
	const encodedLiterals = Buffer.from(
		literals.map((value) => {
			const encoded = (key ^ value) & 0xff;
			key = value;
			return encoded;
		}),
	);
	// The first control word sets the match bits for tokens 3 and 4. Token 3 keeps a non-zero shift
	// register, while token 4 empties it, so the reference reads a second control word whose top bit
	// must be set for the second match. The first match repeats three bytes; the second repeats the
	// three bytes just written.
	const firstControl = Buffer.alloc(4);
	firstControl.writeUInt32LE(0x18000000, 0);
	const first = Buffer.alloc(2);
	first.writeUInt16LE((4 << 12) | 2, 0);
	const secondControl = Buffer.alloc(4);
	secondControl.writeUInt32LE(0x80000000, 0);
	const second = Buffer.alloc(2);
	second.writeUInt16LE((4 << 12) | 5, 0);
	return {
		stream: Buffer.concat([
			firstControl,
			encodedLiterals,
			first,
			secondControl,
			second,
		]),
		output: Buffer.from("ABCABCABCABC"),
	};
}

function packedPayload(unpackedSize: number, stream: Buffer): Buffer {
	const header = Buffer.alloc(8);
	header.write("fACE", 0, "ascii");
	header.writeUInt32LE((unpackedSize ^ SIZE_MASK) >>> 0, 4);
	return Buffer.concat([header, stream]);
}

function buildBmx(entries: readonly Entry[]): Buffer {
	const indexSize = entries.length * 4 + OFFSET_BIAS;
	const archive = Buffer.alloc(
		indexSize +
			entries.reduce((total, entry) => total + entry.payload.length, 0),
	);
	archive.writeInt32LE(entries.length, 0);
	let offset = indexSize;
	for (const [id, entry] of entries.entries()) {
		archive.writeUInt32LE(offset, 4 + id * 4);
		entry.payload.copy(archive, offset);
		offset += entry.payload.length;
	}
	// Trailing sentinel: the last offset must equal the file size.
	archive.writeUInt32LE(offset, 4 + entries.length * 4);
	return archive;
}

describe("Triangle BMX resource archive", () => {
	it("extracts stored and Triangle LZ entries", async () => {
		const raw = Buffer.from("stored payload");
		const { stream, output } = triLzFixture();
		await expectArchive({
			format: triangleBmxFormat,
			archive: buildBmx([
				{ payload: raw },
				{ payload: packedPayload(output.length, stream) },
			]),
			sourcePath: "sample.bmx",
			entries: [
				{ path: "sample#0000", size: raw.length, content: raw },
				{ path: "sample#0001", size: output.length, content: output },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("derives the entry type from fx and gx archive names", async () => {
		const source = new BufferByteSource(
			buildBmx([{ payload: Buffer.from("audio data") }]),
		);
		const archive = await triangleBmxFormat.open(source, "voice.fx");
		try {
			expect(archive.entries[0]?.metadata).toEqual({ type: "audio" });
		} finally {
			await archive.close();
		}
		const imageSource = new BufferByteSource(
			buildBmx([{ payload: Buffer.from("image data") }]),
		);
		const imageArchive = await triangleBmxFormat.open(imageSource, "cg.gx");
		try {
			expect(imageArchive.entries[0]?.metadata).toEqual({ type: "image" });
		} finally {
			await imageArchive.close();
		}
	});

	it("rejects a table whose first offset is not the table size", async () => {
		const archive = buildBmx([{ payload: Buffer.from("x") }]);
		archive.writeUInt32LE(0, 4);
		await expectArchive({
			format: triangleBmxFormat,
			archive,
			sourcePath: "sample.bmx",
			detected: false,
			entries: [],
		});
	});

	it("rejects a table whose sentinel is not the file size", async () => {
		const archive = buildBmx([{ payload: Buffer.from("x") }]);
		archive.writeUInt32LE(0, 8);
		await expectArchive({
			format: triangleBmxFormat,
			archive,
			sourcePath: "sample.bmx",
			detected: false,
			entries: [],
		});
	});
});
