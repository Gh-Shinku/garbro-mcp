import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pinkyA5rFormat } from "../../packages/formats/src/pinky/a5r.js";
import { expectArchive } from "../helpers/archive.js";

const SEGMENT_AUDIO = 0x3c;
const SEGMENT_IMAGE = 0x3e;

interface FixtureSegment {
	/** Plain bytes of the segment. */
	data: Buffer;
	/** When set the segment is stored as a zlib stream of `data`. */
	compressed?: boolean;
	type?: number;
	/** Overrides the recorded unpacked size. */
	unpackedSize?: number;
}

interface FixtureOptions {
	id?: string;
	complement?: boolean;
	countDelta?: number;
	indexOffsetOverride?: number;
	/** Swaps two offsets so the second segment appears to start before the first. */
	decreasingOffset?: boolean;
}

/** Builds an A5R archive: a header, then the segment table, then the segment payloads. */
function buildA5r(
	segments: FixtureSegment[],
	options: FixtureOptions = {},
): Buffer {
	const stored = segments.map((segment) =>
		segment.compressed ? deflateSync(segment.data) : Buffer.from(segment.data),
	);
	const headerSize = 0x38;
	// Records overlap, so the table ends with the last record's next-offset field.
	const tableSize = segments.length * 0xa + 8;
	const payloadStart = headerSize + tableSize;
	const offsets: number[] = [];
	let cursor = payloadStart;
	for (const chunk of stored) {
		offsets.push(cursor);
		cursor += chunk.length;
	}
	const file = Buffer.alloc(cursor);
	const id = Buffer.from(options.id ?? "PCRS", "latin1");
	id.copy(file, 0);
	if (options.complement === false) {
		file.writeUInt32LE(0, 4);
	} else {
		file.writeUInt32LE(~file.readUInt32LE(0) >>> 0, 4);
	}
	file.writeInt32LE(segments.length + (options.countDelta ?? 0), 0x30);
	file.writeUInt32LE(options.indexOffsetOverride ?? headerSize, 0x34);
	let position = headerSize;
	file.writeUInt32LE(offsets[0] ?? payloadStart, position);
	// The seed doubles as the first record's unused leading word, so records start four bytes in.
	position += 4;
	for (const [number, segment] of segments.entries()) {
		file.writeUInt32LE(segment.unpackedSize ?? segment.data.length, position);
		file[position + 4] = segment.type ?? 0;
		file[position + 5] = segment.compressed ? 3 : 0;
		file.writeUInt32LE(offsets[number + 1] ?? cursor, position + 6);
		position += 0xa;
	}
	if (options.decreasingOffset && segments.length > 1) {
		// Make the second record claim an offset before the first one.
		file.writeUInt32LE((offsets[0] ?? 0) - 1, headerSize + 4 + 0xa + 6);
	}
	for (const [number, chunk] of stored.entries())
		chunk.copy(file, offsets[number] ?? 0);
	return file;
}

function sourceOf(archive: Buffer): BufferByteSource {
	return new BufferByteSource(archive);
}

describe("pinky A5R", () => {
	it("registers both PCRS and PLIB signatures", () => {
		expect(
			pinkyA5rFormat.detection?.signatures?.map((signature) =>
				Buffer.from(signature.bytes).toString("latin1"),
			),
		).toEqual(["PCRS", "PLIB"]);
	});

	it("declines a file whose complement word does not match", async () => {
		const built = buildA5r([{ data: Buffer.from("body") }], {
			complement: false,
		});
		expect(await pinkyA5rFormat.detect(sourceOf(built), "GAME.A5R")).toBe(
			false,
		);
	});

	it("declines a file with an insane segment count", async () => {
		const built = buildA5r([{ data: Buffer.from("body") }], {
			countDelta: 0x100000,
		});
		expect(await pinkyA5rFormat.detect(sourceOf(built), "GAME.A5R")).toBe(
			false,
		);
	});

	it("declines an index offset outside the file", async () => {
		const built = buildA5r([{ data: Buffer.from("body") }], {
			indexOffsetOverride: 0x100000,
		});
		expect(await pinkyA5rFormat.detect(sourceOf(built), "GAME.A5R")).toBe(
			false,
		);
	});

	it("declines a segment that starts before the previous one", async () => {
		const built = buildA5r(
			[{ data: Buffer.from("first") }, { data: Buffer.from("second") }],
			{ decreasingOffset: true },
		);
		expect(await pinkyA5rFormat.detect(sourceOf(built), "GAME.A5R")).toBe(
			false,
		);
	});

	it("lists segments as numbered entries of the archive base name", async () => {
		const built = buildA5r([
			{ data: Buffer.from("first") },
			{ data: Buffer.from("second") },
		]);
		await expectArchive({
			format: pinkyA5rFormat,
			archive: built,
			sourcePath: "GAME.A5R",
			entries: [
				{ path: "GAME#00000", size: 5, content: Buffer.from("first") },
				{ path: "GAME#00001", size: 6, content: Buffer.from("second") },
			],
		});
	});

	it("accepts the PLIB signature variant", async () => {
		const built = buildA5r([{ data: Buffer.from("body") }], { id: "PLIB" });
		await expectArchive({
			format: pinkyA5rFormat,
			archive: built,
			sourcePath: "GAME.A5R",
			entries: [{ path: "GAME#00000", size: 4, content: Buffer.from("body") }],
		});
	});

	it("names image segments with a bmp extension", async () => {
		const built = buildA5r([
			{ data: Buffer.from("bitmap"), type: SEGMENT_IMAGE },
		]);
		await expectArchive({
			format: pinkyA5rFormat,
			archive: built,
			sourcePath: "GAME.A5R",
			entries: [
				{ path: "GAME#00000.bmp", size: 6, content: Buffer.from("bitmap") },
			],
		});
		const archive = await pinkyA5rFormat.open(sourceOf(built), "GAME.A5R");
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "image" });
		} finally {
			await archive.close();
		}
	});

	it("inflates a compressed segment", async () => {
		const built = buildA5r([
			{ data: Buffer.from("compressed body"), compressed: true },
		]);
		const archive = await pinkyA5rFormat.open(sourceOf(built), "GAME.A5R");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect({
				size: entry.size,
				compressed: entry.compressed,
				sizeKnown: entry.sizeKnown !== false,
			}).toEqual({ size: 15n, compressed: true, sizeKnown: false });
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.from("compressed body"),
			);
		} finally {
			await archive.close();
		}
	});

	it("merges consecutive riff segments into one wav entry", async () => {
		// The first segment starts a RIFF file, and the unpacked total has to reach the declared
		// RIFF size before the group is closed.
		const head = Buffer.concat([
			Buffer.from("RIFF", "latin1"),
			(() => {
				const size = Buffer.alloc(4);
				size.writeUInt32LE(20, 0);
				return size;
			})(),
			Buffer.from("WAVEdata", "latin1"),
		]);
		const built = buildA5r([
			{ data: head, type: SEGMENT_AUDIO },
			{ data: Buffer.from("tail of the wave"), type: SEGMENT_AUDIO },
		]);
		const archive = await pinkyA5rFormat.open(sourceOf(built), "GAME.A5R");
		try {
			expect(archive.entries).toHaveLength(1);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.path).toBe("GAME#00000.wav");
			expect(entry.metadata).toMatchObject({ type: "audio" });
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.concat([head, Buffer.from("tail of the wave")]),
			);
		} finally {
			await archive.close();
		}
	});

	it("stops an audio group at a segment of another type", async () => {
		const head = Buffer.concat([
			Buffer.from("RIFF", "latin1"),
			(() => {
				const size = Buffer.alloc(4);
				size.writeUInt32LE(0x100, 0);
				return size;
			})(),
			Buffer.from("WAVE", "latin1"),
		]);
		const built = buildA5r([
			{ data: head, type: SEGMENT_AUDIO },
			{ data: Buffer.from("picture"), type: SEGMENT_IMAGE },
			{ data: Buffer.from("script") },
		]);
		const archive = await pinkyA5rFormat.open(sourceOf(built), "GAME.A5R");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"GAME#00000.wav",
				"GAME#00001.bmp",
				"GAME#00002",
			]);
		} finally {
			await archive.close();
		}
	});

	it("keeps an audio segment that is not a riff file as a plain entry", async () => {
		const built = buildA5r([
			{ data: Buffer.from("not a riff at all"), type: SEGMENT_AUDIO },
		]);
		await expectArchive({
			format: pinkyA5rFormat,
			archive: built,
			sourcePath: "GAME.A5R",
			entries: [
				{
					path: "GAME#00000",
					size: 17,
					content: Buffer.from("not a riff at all"),
				},
			],
		});
	});

	it("merges a compressed riff group", async () => {
		const second = Buffer.from("second half");
		const first = Buffer.concat([
			Buffer.from("RIFF", "latin1"),
			(() => {
				const size = Buffer.alloc(4);
				// The group only continues while the accumulated unpacked size is below this value.
				size.writeUInt32LE(9 + second.length, 0);
				return size;
			})(),
			Buffer.from("x"),
		]);
		const built = buildA5r([
			{ data: first, compressed: true, type: SEGMENT_AUDIO },
			{ data: second, compressed: true, type: SEGMENT_AUDIO },
		]);
		const archive = await pinkyA5rFormat.open(sourceOf(built), "GAME.A5R");
		try {
			expect(archive.entries).toHaveLength(1);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.compressed).toBe(true);
			expect(entry.sizeKnown).toBe(false);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.concat([first, second]),
			);
		} finally {
			await archive.close();
		}
	});

	it("marks an uncompressed segment with a matching size as known", async () => {
		const built = buildA5r([{ data: Buffer.from("plain") }]);
		const archive = await pinkyA5rFormat.open(sourceOf(built), "GAME.A5R");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect({
				size: entry.size,
				compressed: entry.compressed,
				sizeKnown: entry.sizeKnown !== false,
			}).toEqual({ size: 5n, compressed: false, sizeKnown: true });
		} finally {
			await archive.close();
		}
	});
});
