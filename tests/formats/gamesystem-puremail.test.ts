import { BufferByteSource } from "@garbro-mcp/core";
import { gamesystemPuremailFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const RECORD_SIZE = 0x50;
const NAME_SIZE = 0x40;
const TRAILER_XOR = 0xf0f0f0f0;
const FLAG_PACKED = 0x010000;
const FLAG_STORED_SIZE = 0x02000000;

interface Spec {
	name: string;
	stored: Buffer;
	/** Declared unpacked size; ignored when the stream carries its own. */
	unpackedSize?: number;
	/** Declared stored size; used to build records that cannot be satisfied. */
	sizeOverride?: number;
	packed?: boolean;
	storedSize?: boolean;
}

/**
 * Encodes `data` as PureMail LZSS literals: a control byte with clear bits, then up to eight bytes.
 */
function pmLzssLiterals(data: Buffer): Buffer {
	const chunks: Buffer[] = [];
	for (let offset = 0; offset < data.length; offset += 8) {
		chunks.push(
			Buffer.from([0]),
			data.subarray(offset, Math.min(offset + 8, data.length)),
		);
	}
	return Buffer.concat([...chunks, Buffer.alloc(data.length === 0 ? 1 : 0)]);
}

/** Lays out a PureMail archive: payloads, a packed index and a twelve byte trailer. */
function buildPm(
	specs: readonly Spec[],
	options?: { trailerSize?: number; indexPad?: number },
): Buffer {
	const index = Buffer.alloc(specs.length * RECORD_SIZE);
	const payloads: Buffer[] = [];
	let offset = 0;
	specs.forEach((spec, id) => {
		const base = id * RECORD_SIZE;
		const flags =
			(spec.packed ? FLAG_PACKED : 0) |
			(spec.storedSize ? FLAG_STORED_SIZE : 0);
		index.writeUInt32LE(flags, base);
		index.write(spec.name, base + 4, "latin1");
		index.writeUInt32LE(offset, base + 4 + NAME_SIZE);
		index.writeUInt32LE(
			spec.sizeOverride ?? spec.stored.length,
			base + 8 + NAME_SIZE,
		);
		index.writeUInt32LE(
			spec.unpackedSize ?? spec.stored.length,
			base + 12 + NAME_SIZE,
		);
		payloads.push(spec.stored);
		offset += spec.stored.length;
	});
	const table = pmLzssLiterals(index);
	const trailer = Buffer.alloc(12);
	trailer.writeUInt32LE((table.length ^ TRAILER_XOR) >>> 0, 0);
	trailer.writeUInt32LE((index.length ^ TRAILER_XOR) >>> 0, 4);
	return Buffer.concat([
		...payloads,
		table,
		Buffer.alloc(options?.indexPad ?? 0),
		trailer.subarray(0, options?.trailerSize ?? 12),
	]);
}

describe("PureMail resource archive", () => {
	it("reads an unpacked entry", async () => {
		const payload = Buffer.from("unpacked puremail payload");
		await expectArchive({
			format: gamesystemPuremailFormat,
			archive: buildPm([{ name: "SCRIPT.DAT", stored: payload }]),
			entries: [{ path: "SCRIPT.DAT", size: payload.length, content: payload }],
			metadata: { entryCount: 1 },
		});
	});

	it("unpacks a packed entry", async () => {
		const unpacked = Buffer.from("packed puremail payload");
		const stored = pmLzssLiterals(unpacked);
		await expectArchive({
			format: gamesystemPuremailFormat,
			archive: buildPm([
				{
					name: "GRAPH.CRGB",
					stored,
					packed: true,
					unpackedSize: unpacked.length,
				},
			]),
			entries: [{ path: "GRAPH.CRGB", size: stored.length, content: unpacked }],
		});
	});

	it("follows a back reference", async () => {
		// One literal then a three byte match that reaches back to it.
		const stored = Buffer.from([0x40, 0x41, 0xe0, 0xfe]);
		await expectArchive({
			format: gamesystemPuremailFormat,
			archive: buildPm([
				{ name: "TEXT.DAT", stored, packed: true, unpackedSize: 4 },
			]),
			entries: [{ path: "TEXT.DAT", size: 4, content: Buffer.from("AAAA") }],
		});
	});

	it("reads the unpacked size from the stream", async () => {
		const unpacked = Buffer.from("stored size wins here");
		const stream = Buffer.concat([Buffer.alloc(4), pmLzssLiterals(unpacked)]);
		stream.writeUInt32LE(unpacked.length, 0);
		await expectArchive({
			format: gamesystemPuremailFormat,
			archive: buildPm([
				{
					name: "MOVIE.DAT",
					stored: stream,
					packed: true,
					storedSize: true,
					// A deliberately wrong declaration that the stream header overrides.
					unpackedSize: 4,
				},
			]),
			entries: [{ path: "MOVIE.DAT", size: stream.length, content: unpacked }],
		});
	});

	it("reports packed entries with an unknown size", async () => {
		const unpacked = Buffer.from("packed entry");
		const stored = pmLzssLiterals(unpacked);
		const file = buildPm([
			{ name: "A.CHAR", stored, packed: true, unpackedSize: unpacked.length },
		]);
		const archive = await gamesystemPuremailFormat.open(
			new BufferByteSource(file),
			"archive.dat",
		);
		try {
			expect(archive.entries[0]).toMatchObject({
				path: "A.CHAR",
				size: BigInt(stored.length),
				sizeKnown: false,
				compressed: true,
				packedSize: BigInt(stored.length),
				metadata: { unpackedSize: unpacked.length, type: "image" },
			});
		} finally {
			await archive.close();
		}
	});

	it("types images by extension", async () => {
		const file = buildPm([
			{ name: "A.CRGB", stored: Buffer.from([1, 2, 3, 4]) },
			{ name: "B.ROL", stored: Buffer.from([5, 6, 7, 8]) },
			{ name: "C.BMP", stored: Buffer.from([9, 10, 11, 12]) },
		]);
		const archive = await gamesystemPuremailFormat.open(
			new BufferByteSource(file),
			"archive.dat",
		);
		try {
			expect(archive.entries.map((entry) => entry.metadata?.type)).toEqual([
				"image",
				"image",
				undefined,
			]);
		} finally {
			await archive.close();
		}
	});

	it("rejects an index that does not divide into records", async () => {
		const file = buildPm([
			{ name: "A.DAT", stored: Buffer.from([1, 2, 3, 4]) },
		]);
		file.writeUInt32LE(((0x50 + 1) ^ TRAILER_XOR) >>> 0, file.length - 8);
		expect(
			await gamesystemPuremailFormat.detect(
				new BufferByteSource(file),
				"a.dat",
			),
		).toBe(false);
	});

	it("rejects an index that overruns the file", async () => {
		const file = buildPm([
			{ name: "A.DAT", stored: Buffer.from([1, 2, 3, 4]) },
		]);
		file.writeUInt32LE((0x1000 ^ TRAILER_XOR) >>> 0, file.length - 12);
		expect(
			await gamesystemPuremailFormat.detect(
				new BufferByteSource(file),
				"a.dat",
			),
		).toBe(false);
	});

	it("rejects a payload that does not fit", async () => {
		const file = buildPm([
			{
				name: "A.DAT",
				stored: Buffer.from([1, 2, 3, 4]),
				sizeOverride: 0x1000,
			},
		]);
		expect(
			await gamesystemPuremailFormat.detect(
				new BufferByteSource(file),
				"a.dat",
			),
		).toBe(false);
	});

	it("rejects an empty index", async () => {
		const file = buildPm([]);
		expect(
			await gamesystemPuremailFormat.detect(
				new BufferByteSource(file),
				"a.dat",
			),
		).toBe(false);
	});

	it("rejects a file without a full trailer", async () => {
		const file = buildPm(
			[{ name: "A.DAT", stored: Buffer.from([1, 2, 3, 4]) }],
			{
				trailerSize: 8,
			},
		);
		expect(
			await gamesystemPuremailFormat.detect(
				new BufferByteSource(file),
				"a.dat",
			),
		).toBe(false);
	});
});
