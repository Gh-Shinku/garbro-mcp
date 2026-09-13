import { BufferByteSource } from "@garbro-mcp/core";
import { supernekoxGpc7Format } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const OFFSET_TABLE = 8;
const ENTRY_HEADER_SIZE = 8;
const LITERAL_LIMIT = 0x1d;

interface Spec {
	payload: Buffer;
	/** Marks an outer compressed entry; the payload holds the packed stream. */
	packed?: boolean;
	/** Unpacked size of an outer compressed entry. */
	unpackedSize?: number;
}

/** Encodes `data` with the outer codec's literal run commands. */
function gpcLiterals(data: Buffer): Buffer {
	const chunks: Buffer[] = [];
	for (let offset = 0; offset < data.length; offset += LITERAL_LIMIT) {
		const run = data.subarray(
			offset,
			Math.min(offset + LITERAL_LIMIT, data.length),
		);
		chunks.push(Buffer.from([run.length - 1]), run);
	}
	return Buffer.concat(chunks);
}

/** Encodes `data` with the inner codec's literal control bytes. */
function innerLiterals(data: Buffer): Buffer {
	const chunks: Buffer[] = [];
	for (let offset = 0; offset < data.length; offset += 8) {
		chunks.push(
			Buffer.from([0]),
			data.subarray(offset, Math.min(offset + 8, data.length)),
		);
	}
	return Buffer.concat(chunks);
}

/** Wraps `data` in the inner layer header the opener looks for. */
function innerStream(data: Buffer): Buffer {
	const header = Buffer.alloc(4);
	header.writeUInt16LE(data.length, 0);
	header.writeUInt16LE(innerLiterals(data).length, 2);
	return Buffer.concat([header, innerLiterals(data)]);
}

/** Lays out a Gpc7 archive with one header record per entry. */
function buildGpc(specs: readonly Spec[]): Buffer {
	const count = specs.length;
	const bodies = specs.map((spec) => {
		const header = Buffer.alloc(ENTRY_HEADER_SIZE);
		// A zero packed size marks a stored payload; otherwise both sizes are meaningful.
		header.writeUInt32LE(spec.packed ? spec.payload.length : 0, 0);
		header.writeUInt32LE(spec.unpackedSize ?? spec.payload.length, 4);
		return Buffer.concat([header, spec.payload]);
	});
	const table = Buffer.alloc(count * 4);
	let offset = OFFSET_TABLE + table.length;
	bodies.forEach((body, id) => {
		table.writeUInt32LE(offset, id * 4);
		offset += body.length;
	});
	const header = Buffer.alloc(OFFSET_TABLE);
	header.write("Gpc7", 0, "latin1");
	header.writeInt32LE(count, 4);
	return Buffer.concat([header, table, ...bodies]);
}

describe("Super NekoX engine resource archive", () => {
	it("reads an entry without payload header compression", async () => {
		const payload = Buffer.from("raw payload bytes");
		await expectArchive({
			format: supernekoxGpc7Format,
			sourcePath: "data.gpc",
			archive: buildGpc([{ payload }]),
			entries: [{ path: "data#0000", size: payload.length, content: payload }],
		});
	});

	it("unpacks an outer compressed entry", async () => {
		const unpacked = Buffer.from("outer compressed payload");
		const packed = gpcLiterals(unpacked);
		await expectArchive({
			format: supernekoxGpc7Format,
			sourcePath: "data.gpc",
			archive: buildGpc([
				{ payload: packed, packed: true, unpackedSize: unpacked.length },
			]),
			entries: [
				{ path: "data#0000", size: unpacked.length, content: unpacked },
			],
		});
	});

	it("unpacks an inner compressed entry", async () => {
		const unpacked = Buffer.from("inner compressed payload");
		const payload = innerStream(unpacked);
		await expectArchive({
			format: supernekoxGpc7Format,
			sourcePath: "data.gpc",
			archive: buildGpc([{ payload }]),
			entries: [
				{ path: "data#0000", size: unpacked.length, content: unpacked },
			],
		});
	});

	it("unpacks both layers", async () => {
		const unpacked = Buffer.from("doubly compressed payload");
		const payload = innerStream(unpacked);
		const packed = gpcLiterals(payload);
		await expectArchive({
			format: supernekoxGpc7Format,
			sourcePath: "data.gpc",
			archive: buildGpc([
				{ payload: packed, packed: true, unpackedSize: payload.length },
			]),
			entries: [
				{ path: "data#0000", size: unpacked.length, content: unpacked },
			],
		});
	});

	it("keeps a payload that only looks compressed", async () => {
		// The declared packed size does not cover the stream, so the inner layer is left alone.
		const unpacked = Buffer.from("inner compressed payload");
		const payload = Buffer.concat([innerStream(unpacked), Buffer.from([0])]);
		await expectArchive({
			format: supernekoxGpc7Format,
			sourcePath: "data.gpc",
			archive: buildGpc([{ payload }]),
			entries: [{ path: "data#0000", size: payload.length, content: payload }],
		});
	});

	it("types a tga header as an image", async () => {
		// Little endian 0x00020000, the third byte of a true colour TGA header.
		const payload = Buffer.concat([
			Buffer.from([0, 0, 2, 0]),
			Buffer.alloc(0x20),
		]);
		const file = buildGpc([{ payload }]);
		const archive = await supernekoxGpc7Format.open(
			new BufferByteSource(file),
			"data.gpc",
		);
		try {
			expect(archive.entries[0]?.metadata?.type).toBe("image");
		} finally {
			await archive.close();
		}
	});

	it("types a riff header by the shared detector", async () => {
		const payload = Buffer.concat([
			Buffer.from("RIFF", "latin1"),
			Buffer.alloc(0x20),
		]);
		const file = buildGpc([{ payload }]);
		const archive = await supernekoxGpc7Format.open(
			new BufferByteSource(file),
			"data.gpc",
		);
		try {
			expect(archive.entries[0]?.metadata?.type).toBe("audio");
		} finally {
			await archive.close();
		}
	});

	it("types an outer compressed entry", async () => {
		const payload = Buffer.concat([
			Buffer.from([0, 0, 2, 0]),
			Buffer.alloc(0x20),
		]);
		const packed = gpcLiterals(payload);
		const file = buildGpc([
			{ payload: packed, packed: true, unpackedSize: payload.length },
		]);
		const archive = await supernekoxGpc7Format.open(
			new BufferByteSource(file),
			"data.gpc",
		);
		try {
			expect(archive.entries[0]).toMatchObject({
				size: BigInt(payload.length),
				compressed: true,
				packedSize: BigInt(packed.length),
				metadata: { outerPacked: true, type: "image" },
			});
		} finally {
			await archive.close();
		}
	});

	it("reports the inner unpacked size", async () => {
		const unpacked = Buffer.from("inner compressed payload");
		const payload = innerStream(unpacked);
		const file = buildGpc([{ payload }]);
		const archive = await supernekoxGpc7Format.open(
			new BufferByteSource(file),
			"data.gpc",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				innerUnpackedSize: unpacked.length,
			});
		} finally {
			await archive.close();
		}
	});

	it("numbers entries by record", async () => {
		const file = buildGpc([
			{ payload: Buffer.from("one") },
			{ payload: Buffer.from("two") },
		]);
		const archive = await supernekoxGpc7Format.open(
			new BufferByteSource(file),
			"pack.gpc",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"pack#0000",
				"pack#0001",
			]);
		} finally {
			await archive.close();
		}
	});

	it("registers the Gpc7 signature", () => {
		expect(supernekoxGpc7Format.detection?.signatures).toEqual([
			{ bytes: Buffer.from("Gpc7", "latin1") },
		]);
	});

	it("rejects a bad record count", async () => {
		const file = buildGpc([{ payload: Buffer.from("x") }]);
		file.writeInt32LE(0, 4);
		expect(
			await supernekoxGpc7Format.detect(new BufferByteSource(file), "a.gpc"),
		).toBe(false);
	});

	it("rejects an offset inside the index", async () => {
		const file = buildGpc([{ payload: Buffer.from("x") }]);
		file.writeUInt32LE(4, OFFSET_TABLE);
		expect(
			await supernekoxGpc7Format.detect(new BufferByteSource(file), "a.gpc"),
		).toBe(false);
	});

	it("rejects a span past the end of file", async () => {
		const file = buildGpc([
			{ payload: Buffer.from("first") },
			{ payload: Buffer.from("second") },
		]);
		file.writeUInt32LE(0xffffff00, OFFSET_TABLE + 4);
		expect(
			await supernekoxGpc7Format.detect(new BufferByteSource(file), "a.gpc"),
		).toBe(false);
	});

	it("rejects a truncated offset table", async () => {
		const file = buildGpc([{ payload: Buffer.from("x") }]).subarray(
			0,
			OFFSET_TABLE + 2,
		);
		expect(
			await supernekoxGpc7Format.detect(new BufferByteSource(file), "a.gpc"),
		).toBe(false);
	});
});
