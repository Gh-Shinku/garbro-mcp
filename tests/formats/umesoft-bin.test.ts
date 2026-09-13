import { BufferByteSource } from "@garbro-mcp/core";
import {
	decodeIkeSize,
	umeSoftBinFormat,
	unpackIke,
} from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_OFFSET = 0xc;
const RECORD_SIZE = 0xc;
const OFFSET_SHIFT = 11;
const IKE_HEADER_SIZE = 13;

/**
 * Mirrors the decoder's own read order: a 16-bit window is loaded first and the bytes read inside that
 * window follow it, so both are buffered until the window closes.
 */
class IkeWriter {
	readonly out: number[] = [];
	#word = 0;
	#bits = 0;
	#bytes: number[] = [];

	bit(value: number): void {
		this.#word |= (value & 1) << this.#bits;
		this.#bits += 1;
		if (this.#bits === 16) this.#flush();
	}

	byte(value: number): void {
		this.#bytes.push(value & 0xff);
	}

	#flush(): void {
		this.out.push(this.#word & 0xff, (this.#word >> 8) & 0xff, ...this.#bytes);
		this.#word = 0;
		this.#bits = 0;
		this.#bytes = [];
	}

	finish(): Buffer {
		if (this.#bits > 0 || this.#bytes.length > 0) this.#flush();
		return Buffer.from(this.out);
	}
}

/** Encodes a payload as literal tokens, one flag bit and one byte each. */
function encodeIkeLiterals(content: Buffer): Buffer {
	const writer = new IkeWriter();
	for (const byte of content) {
		writer.bit(1);
		writer.byte(byte);
	}
	return writer.finish();
}

/**
 * Encodes the three size bytes the Ike header carries. The reference reads them as
 * `DecodeSize (a, b, c) = b + ((c + (a >> 2 << 8)) << 8)`, so the high six bits come first and the
 * low byte sits in the middle of the triplet.
 */
function encodeIkeSize(size: number): Buffer {
	return Buffer.from([(size >>> 16) << 2, size & 0xff, (size >>> 8) & 0xff]);
}

interface Entry {
	id: number;
	/** Stored payload; packed entries receive the Ike header automatically. */
	payload: Buffer;
	packed?: boolean;
	/** Unpacked size for packed fixtures; defaults to the stored payload length. */
	declaredSize?: number;
}

function buildBin(entries: readonly Entry[]): Buffer {
	const payloads = entries.map((entry) => {
		if (!entry.packed) return entry.payload;
		const header = Buffer.alloc(IKE_HEADER_SIZE);
		header[2] = 0x69; // 'i'
		header[3] = 0x6b; // 'k'
		header[4] = 0x65; // 'e'
		// Packed fixtures declare the length of their decoded form, which is the literal count.
		encodeIkeSize(entry.declaredSize ?? entry.payload.length).copy(header, 10);
		return Buffer.concat([header, entry.payload]);
	});
	const dataStart = 2048;
	const strides = payloads.map(
		(payload) => Math.ceil(payload.length / 2048) * 2048,
	);
	const starts: number[] = [];
	let cursor = dataStart;
	for (const stride of strides) {
		starts.push(cursor);
		cursor += Math.max(stride, 2048);
	}
	const archive = Buffer.alloc(cursor);
	archive.writeInt32LE((entries.length + 1) << 16, 0);
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		archive.writeUInt32LE(entry.id, record);
		archive.writeUInt32LE((starts[id] ?? 0) >> OFFSET_SHIFT, record + 4);
		archive.writeUInt32LE(payloads[id]?.length ?? 0, record + 8);
		payloads[id]?.copy(archive, starts[id] ?? 0);
	}
	return archive;
}

describe("U-Me Soft BIN resources archive", () => {
	it("decodes the three-byte packed size", () => {
		// Arguments are (high, low, middle): 0x123456 encodes as 0x48, 0x56, 0x34.
		expect(decodeIkeSize(0x48, 0x56, 0x34)).toBe(0x123456);
		expect(decodeIkeSize(0, 1, 0)).toBe(1);
	});

	it("decodes literal tokens", () => {
		const content = Buffer.from("AB");
		expect(unpackIke(encodeIkeLiterals(content), 2)).toEqual(content);
	});

	it("decodes a short back reference", () => {
		// Two literals followed by a distance-two match of length two.
		const writer = new IkeWriter();
		writer.bit(1);
		writer.byte(0x41);
		writer.bit(1);
		writer.byte(0x42);
		writer.bit(0);
		writer.byte(0xfe);
		writer.bit(0);
		expect(unpackIke(writer.finish(), 4).toString("latin1")).toBe("ABAB");
	});

	it("reads stored entries with zero-padded names", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		const archive = buildBin([
			{ id: 42, payload: first },
			{ id: 7, payload: second },
		]);
		await expectArchive({
			format: umeSoftBinFormat,
			archive,
			metadata: { entryCount: 2 },
			entries: [
				{ path: "00042", size: first.length, content: first },
				{ path: "00007", size: second.length, content: second },
			],
		});
	});

	it("decodes packed entries behind the ike header", async () => {
		const content = Buffer.from("BM packed payload");
		const archive = buildBin([
			{
				id: 1,
				payload: encodeIkeLiterals(content),
				packed: true,
				declaredSize: content.length,
			},
		]);
		await expectArchive({
			format: umeSoftBinFormat,
			archive,
			entries: [{ path: "00001", size: content.length, content }],
		});
	});

	it("types a packed payload from the probed signature", async () => {
		// The probe reads fifteen bytes into the record, i.e. two bytes into the payload, where the
		// first two literal bytes sit.
		const content = Buffer.from("BM pixel data");
		const archive = buildBin([
			{
				id: 1,
				payload: encodeIkeLiterals(content),
				packed: true,
				declaredSize: content.length,
			},
		]);
		const listing = await umeSoftBinFormat.open(
			new BufferByteSource(archive),
			"sample.bin",
		);
		try {
			expect(listing.entries.map((entry) => entry.metadata)).toEqual([
				{ type: "image" },
			]);
		} finally {
			await listing.close();
		}
	});

	it("rejects a count word whose low half is not zero", async () => {
		const archive = buildBin([{ id: 1, payload: Buffer.from("payload") }]);
		archive.writeInt32LE((2 << 16) | 1, 0);
		const source = new BufferByteSource(archive);
		expect(await umeSoftBinFormat.detect(source)).toBe(false);
	});

	it("rejects an entry that falls outside the archive", async () => {
		const archive = buildBin([{ id: 1, payload: Buffer.from("payload") }]);
		archive.writeUInt32LE(0x1000, INDEX_OFFSET + 4);
		const source = new BufferByteSource(archive);
		expect(await umeSoftBinFormat.detect(source)).toBe(false);
	});
});
