import { describe, expect, it } from "vitest";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { g2PakFormat } from "../../packages/formats/src/g2/pak.js";
import { expectArchive } from "../helpers/archive.js";

/** Packs bits most significant first, the order the control stream reader expects. */
class BitWriter {
	private readonly bits: number[] = [];

	write(bit: number): void {
		this.bits.push(bit & 1);
	}

	/** `GceReader.GetLength` reads a zero bit followed by a unary digit count and its payload. */
	writeLength(value: number): void {
		if (value === 0) {
			this.write(1);
			return;
		}
		this.write(0);
		let digits = 0;
		while (1 << (digits + 1) <= value) digits += 1;
		for (let i = 0; i < digits; i += 1) this.write(0);
		this.write(1);
		for (let i = digits - 1; i >= 0; i -= 1)
			this.write((value - (1 << digits)) >> i);
	}

	toBuffer(): Buffer {
		const bytes = Buffer.alloc(Math.max(1, Math.ceil(this.bits.length / 8)));
		for (const [index, bit] of this.bits.entries()) {
			if (bit === 0) continue;
			const position = index >> 3;
			bytes[position] = (bytes[position] ?? 0) | (0x80 >> (index & 7));
		}
		return bytes;
	}
}

function u32(value: number): Buffer {
	const buffer = Buffer.alloc(4);
	buffer.writeUInt32LE(value >>> 0, 0);
	return buffer;
}

/** A `GCE1` segment: literals are the data, and every match takes its source from the frame table. */
function gce1Segment(
	segmentLength: number,
	literals: Buffer,
	control: Buffer,
): Buffer {
	return Buffer.concat([
		Buffer.from("GCE1", "latin1"),
		u32(segmentLength),
		u32(0),
		u32(literals.length),
		u32(0),
		u32(control.length),
		literals,
		control,
	]);
}

/** A stored `GCE0` segment. */
function gce0Segment(data: Buffer): Buffer {
	return Buffer.concat([Buffer.from("GCE0", "latin1"), u32(data.length), data]);
}

/**
 * Encodes a segment that emits the given literal runs and then one match. The match source is the
 * position the decoder's frame table holds for the current two byte context, so the caller has to
 * know that position; `matchTail` describes the bytes the match is expected to copy.
 */
function gce1LiteralsThenMatch(
	literalBytes: Buffer,
	matchCount: number,
): Buffer {
	const bits = new BitWriter();
	bits.writeLength(literalBytes.length);
	bits.writeLength(matchCount - 1);
	return gce1Segment(
		literalBytes.length + matchCount,
		literalBytes,
		bits.toBuffer(),
	);
}

interface FixtureEntry {
	name: string;
	/** Stored bytes. */
	data: Buffer;
	/** Extracted bytes when the entry is packed, otherwise the stored bytes are returned as they are. */
	unpacked?: Buffer;
}

interface FixtureOptions {
	entries: FixtureEntry[];
	packedIndex?: boolean;
	indexSizeDelta?: number;
	headerWord4?: number;
	indexSignature?: string;
}

interface BuiltArchive {
	archive: Buffer;
	/** Payload offsets in file order, which the index records implicitly. */
	offsets: number[];
}

/** Builds a GCEX archive whose payloads are laid out contiguously from 0x10. */
function buildGcex(options: FixtureOptions): BuiltArchive {
	const payloads: Buffer[] = [];
	const offsets: number[] = [];
	let cursor = 0x10;
	for (const entry of options.entries) {
		offsets.push(cursor);
		payloads.push(entry.data);
		cursor += entry.data.length;
	}
	const records = Buffer.alloc(0x20 * options.entries.length);
	const names: Buffer[] = [];
	for (const [number, entry] of options.entries.entries()) {
		const name = Buffer.from(entry.name, "latin1");
		names.push(
			Buffer.concat([
				Buffer.from([name.length & 0xff, (name.length >> 8) & 0xff]),
				name,
			]),
		);
		const unpacked = entry.unpacked ?? entry.data;
		records.writeUInt32LE(unpacked.length, number * 0x20 + 0x10);
		records.writeUInt32LE(entry.data.length, number * 0x20 + 0x18);
	}
	const index = Buffer.concat([records, ...names]);
	const indexData = options.packedIndex
		? (() => {
				const bits = new BitWriter();
				bits.writeLength(index.length);
				return gce1Segment(index.length, index, bits.toBuffer());
			})()
		: index;
	const indexOffset = cursor + (options.packedIndex ? 0x28 : 0x20);
	const payloadRegion = Buffer.concat(payloads);
	// Leave room for the eight byte index preamble in front of the index body.
	const file = Buffer.alloc(
		Math.max(indexOffset + 0x28 + indexData.length, cursor),
	);
	file.write("GCEX", 0, "latin1");
	file.writeUInt32LE((options.headerWord4 ?? 0) >>> 0, 4);
	file.writeBigInt64LE(BigInt(indexOffset), 8);
	payloadRegion.copy(file, 0x10);
	// The index signature and its two length fields sit in front of the index body.
	const packed = options.packedIndex ?? false;
	file.write(options.indexSignature ?? "GCE3", indexOffset, "latin1");
	file.writeUInt32LE(packed ? 0x11 : 0, indexOffset + 4);
	if (packed) {
		file.writeUInt32LE(
			// The length field spans the index body and its eight byte preamble.
			indexData.length + 0x28 + (options.indexSizeDelta ?? 0),
			indexOffset + 8,
		);
		file.writeUInt32LE(index.length, indexOffset + 0x20);
		indexData.copy(file, indexOffset + 0x28);
	} else {
		file.writeUInt32LE(
			indexData.length + 0x20 + (options.indexSizeDelta ?? 0),
			indexOffset + 8,
		);
		file.writeUInt32LE(options.entries.length, indexOffset + 0x18);
		indexData.copy(file, indexOffset + 0x20);
	}
	if (packed) file.writeUInt32LE(options.entries.length, indexOffset + 0x18);
	return { archive: file, offsets };
}

function sourceOf(archive: Buffer): BufferByteSource {
	return new BufferByteSource(archive);
}

describe("g2 PAK", () => {
	it("registers the GCEX signature", () => {
		expect(g2PakFormat.detection?.signatures?.[0]?.bytes).toEqual(
			Buffer.from("GCEX", "latin1"),
		);
	});

	it("declines a file without the signature", async () => {
		expect(
			await g2PakFormat.detect(sourceOf(Buffer.alloc(64)), "TEST.PAK"),
		).toBe(false);
	});

	it("declines an archive whose fourth word is not zero", async () => {
		const built = buildGcex({
			entries: [{ name: "A", data: Buffer.from("a") }],
			headerWord4: 1,
		});
		expect(await g2PakFormat.detect(sourceOf(built.archive), "TEST.PAK")).toBe(
			false,
		);
	});

	it("declines an index without the GCE3 signature", async () => {
		const built = buildGcex({
			entries: [{ name: "A", data: Buffer.from("a") }],
			indexSignature: "GCE9",
		});
		expect(await g2PakFormat.detect(sourceOf(built.archive), "TEST.PAK")).toBe(
			false,
		);
	});

	it("lists stored and packed entries", async () => {
		const packed = Buffer.from("packed body");
		const built = buildGcex({
			entries: [
				{ name: "A", data: Buffer.from("stored") },
				{
					name: "B",
					data: gce0Segment(packed),
					unpacked: packed,
				},
			],
		});
		await expectArchive({
			format: g2PakFormat,
			archive: built.archive,
			entries: [
				{ path: "A", size: 6, content: Buffer.from("stored") },
				{ path: "B", size: packed.length, content: packed },
			],
			metadata: { indexPacked: false },
		});
	});

	it("copies a match from the frame table", async () => {
		// The decoder records where each two byte context was written. After "ABAB" the context
		// "AB" maps to output position two, so a match of two copies "AB" again.
		const stream = gce1LiteralsThenMatch(Buffer.from("ABAB"), 2);
		const built = buildGcex({
			entries: [{ name: "A", data: stream, unpacked: Buffer.from("ABABAB") }],
		});
		await expectArchive({
			format: g2PakFormat,
			archive: built.archive,
			entries: [{ path: "A", size: 6, content: Buffer.from("ABABAB") }],
		});
	});

	it("reads an index that is itself a GCE stream", async () => {
		const built = buildGcex({
			entries: [
				{ name: "A", data: Buffer.from("first") },
				{ name: "B", data: Buffer.from("second") },
			],
			packedIndex: true,
		});
		await expectArchive({
			format: g2PakFormat,
			archive: built.archive,
			entries: [
				{ path: "A", size: 5, content: Buffer.from("first") },
				{ path: "B", size: 6, content: Buffer.from("second") },
			],
			metadata: { indexPacked: true },
		});
	});

	it("keeps hierarchical names from the index", async () => {
		const built = buildGcex({
			entries: [{ name: "SUB\\FILE", data: Buffer.from("deep") }],
		});
		await expectArchive({
			format: g2PakFormat,
			archive: built.archive,
			entries: [{ path: "SUB/FILE", size: 4, content: Buffer.from("deep") }],
		});
	});

	it("skips zero sized records without advancing the payload offset", async () => {
		const built = buildGcex({
			entries: [
				{ name: "A", data: Buffer.from("first") },
				{ name: "EMPTY", data: Buffer.alloc(0) },
				{ name: "B", data: Buffer.from("second") },
			],
		});
		const archive = await g2PakFormat.open(sourceOf(built.archive), "TEST.PAK");
		try {
			// The empty record stores a size of zero, so it does not appear in the listing.
			expect(archive.entries.map((entry) => entry.path)).toEqual(["A", "B"]);
			const second = archive.entries[1];
			if (!second) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(second.id))).toEqual(
				Buffer.from("second"),
			);
		} finally {
			await archive.close();
		}
	});

	it("marks packed entries as sized from the index", async () => {
		const plain = Buffer.from("0123456789");
		const built = buildGcex({
			entries: [{ name: "A", data: gce0Segment(plain), unpacked: plain }],
		});
		const archive = await g2PakFormat.open(sourceOf(built.archive), "TEST.PAK");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect({
				size: entry.size,
				packedSize: entry.packedSize,
				compressed: entry.compressed,
				sizeKnown: entry.sizeKnown !== false,
			}).toEqual({
				size: 10n,
				packedSize: 18n,
				compressed: true,
				sizeKnown: false,
			});
		} finally {
			await archive.close();
		}
	});

	it("rejects a payload with an unknown segment type", async () => {
		const stream = Buffer.concat([
			Buffer.from("GCE7", "latin1"),
			u32(4),
			Buffer.from("data"),
		]);
		const built = buildGcex({
			entries: [{ name: "A", data: stream, unpacked: Buffer.from("data") }],
		});
		const archive = await g2PakFormat.open(sourceOf(built.archive), "TEST.PAK");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(
				(async () => consumeBuffer(await archive.openEntry(entry.id)))(),
			).rejects.toThrow(/Invalid GCE stream/);
		} finally {
			await archive.close();
		}
	});

	it("returns a packed entry verbatim when it is not a GCE stream", async () => {
		const built = buildGcex({
			entries: [
				{
					name: "A",
					data: Buffer.from("not compressed at all"),
					unpacked: Buffer.alloc(23),
				},
			],
		});
		// The reference traces a warning and returns the stored bytes untouched.
		await expectArchive({
			format: g2PakFormat,
			archive: built.archive,
			entries: [
				{ path: "A", size: 23, content: Buffer.from("not compressed at all") },
			],
		});
	});

	it("declines an index that does not fit in the file", async () => {
		const built = buildGcex({
			entries: [{ name: "A", data: Buffer.from("a") }],
			indexSizeDelta: 0x10000,
		});
		expect(await g2PakFormat.detect(sourceOf(built.archive), "TEST.PAK")).toBe(
			false,
		);
	});

	it("declines an index pointer outside the file", async () => {
		const built = buildGcex({
			entries: [{ name: "A", data: Buffer.from("a") }],
		});
		// Point the header at an offset past the end of the file.
		built.archive.writeBigInt64LE(BigInt(built.archive.length + 0x1000), 8);
		expect(await g2PakFormat.detect(sourceOf(built.archive), "TEST.PAK")).toBe(
			false,
		);
	});
});
