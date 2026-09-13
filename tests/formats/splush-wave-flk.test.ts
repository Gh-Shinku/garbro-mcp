import { BufferByteSource } from "@garbro-mcp/core";
import { flkDatFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_OFFSET = 0x20;
const RECORD_SIZE = 0x10;
const ARC_SIZE_FIELD = 0x14;
const COUNT_FIELD = 0x18;
const PACKED_FLAG = 1;
const FRAME_INIT_POSITION = 0x3be;

/**
 * Writes control bits from the least significant one. The decoder refills its control byte before it reads
 * the payload of a decision, so every group of eight bits is emitted as the control byte followed by the
 * bytes its decisions consume.
 */
class FlkWriter {
	readonly #groups: { control: number; bytes: number[] }[] = [];
	#current = { control: 0, bytes: [] as number[] };
	#position = 0;

	#push(bit: number, ...bytes: number[]): void {
		if (this.#position === 8) {
			this.#groups.push(this.#current);
			this.#current = { control: 0, bytes: [] };
			this.#position = 0;
		}
		if (bit !== 0) this.#current.control |= 1 << this.#position;
		this.#current.bytes.push(...bytes);
		this.#position += 1;
	}

	literal(value: number): void {
		this.#push(0, value & 0xff);
	}

	copy(offset: number, count: number): void {
		this.#push(1, offset & 0xff, ((offset >> 2) & 0xc0) | (count - 3));
	}

	finish(): Buffer {
		if (this.#position > 0) this.#groups.push(this.#current);
		return Buffer.from(
			this.#groups.flatMap((group) => [group.control, ...group.bytes]),
		);
	}
}

/** Lays out the header, the index and the payloads, patching the archive size into the header. */
function buildFlk(
	specs: readonly { payload: Buffer; packed: boolean }[],
): Buffer {
	const indexSize = specs.length * RECORD_SIZE;
	const dataOffset = INDEX_OFFSET + indexSize;
	const header = Buffer.alloc(INDEX_OFFSET);
	header.write("FLK", 0, "latin1");
	header.writeInt32LE(specs.length, COUNT_FIELD);
	const index = Buffer.alloc(indexSize);
	const payloads: Buffer[] = [];
	let offset = dataOffset;
	for (const [id, spec] of specs.entries()) {
		const position = id * RECORD_SIZE;
		index.writeUInt32LE(offset, position + 0);
		index.writeUInt32LE(spec.payload.length, position + 4);
		index[position + 0xf] = spec.packed ? PACKED_FLAG : 0;
		payloads.push(spec.payload);
		offset += spec.payload.length;
	}
	const file = Buffer.concat([header, index, ...payloads]);
	file.writeUInt32LE(file.length, ARC_SIZE_FIELD);
	return file;
}

describe("Splush Wave resource archive", () => {
	it("lists entries with generated names", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload bytes");
		await expectArchive({
			format: flkDatFormat,
			sourcePath: "knock.dat",
			archive: buildFlk([
				{ payload: first, packed: false },
				{ payload: second, packed: false },
			]),
			entries: [
				{ path: "knock#0000", size: first.length, content: first },
				{ path: "knock#0001", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("unpacks a packed payload", async () => {
		const writer = new FlkWriter();
		for (const byte of Buffer.from("abcdef")) writer.literal(byte);
		// A copy of the three bytes that were just written.
		writer.copy(FRAME_INIT_POSITION, 3);
		const stored = writer.finish();
		await expectArchive({
			format: flkDatFormat,
			sourcePath: "knock.dat",
			archive: buildFlk([{ payload: stored, packed: true }]),
			entries: [
				{
					path: "knock#0000",
					size: stored.length,
					content: Buffer.from("abcdefabc"),
				},
			],
		});
	});

	it("repeats bytes from the frame", async () => {
		const writer = new FlkWriter();
		for (const byte of Buffer.from("xyz")) writer.literal(byte);
		writer.copy(FRAME_INIT_POSITION, 6);
		const stored = writer.finish();
		await expectArchive({
			format: flkDatFormat,
			sourcePath: "knock.dat",
			archive: buildFlk([{ payload: stored, packed: true }]),
			entries: [
				{
					path: "knock#0000",
					size: stored.length,
					content: Buffer.from("xyzxyzxyz"),
				},
			],
		});
	});

	it("marks payloads that carry an image marker", async () => {
		const image = Buffer.from("SWG\0image bytes");
		const other = Buffer.from("plain bytes");
		const archive = await flkDatFormat.open(
			new BufferByteSource(
				buildFlk([
					{ payload: image, packed: false },
					{ payload: other, packed: false },
				]),
			),
			"knock.dat",
		);
		expect(archive.entries[0]?.metadata?.type).toBe("image");
		expect(archive.entries[1]?.metadata?.type).toBe("data");
	});

	it("marks payloads whose marker sits one byte in", async () => {
		const image = Buffer.from("_SWGimage bytes");
		const archive = await flkDatFormat.open(
			new BufferByteSource(buildFlk([{ payload: image, packed: false }])),
			"knock.dat",
		);
		expect(archive.entries[0]?.metadata?.type).toBe("image");
	});

	it("rejects an archive size that does not match", async () => {
		const file = buildFlk([{ payload: Buffer.from("payload"), packed: false }]);
		file.writeUInt32LE(file.length + 0x10, ARC_SIZE_FIELD);
		expect(await flkDatFormat.detect(new BufferByteSource(file), "a.dat")).toBe(
			false,
		);
	});

	it("rejects an archive without entries", async () => {
		const file = buildFlk([{ payload: Buffer.from("payload"), packed: false }]);
		file.writeInt32LE(0, COUNT_FIELD);
		file.writeUInt32LE(file.length, ARC_SIZE_FIELD);
		expect(await flkDatFormat.detect(new BufferByteSource(file), "a.dat")).toBe(
			false,
		);
	});

	it("rejects a foreign signature", async () => {
		const file = buildFlk([{ payload: Buffer.from("payload"), packed: false }]);
		file.write("FLJ", 0, "latin1");
		expect(await flkDatFormat.detect(new BufferByteSource(file), "a.dat")).toBe(
			false,
		);
	});

	it("rejects an entry that leaves the file", async () => {
		const file = buildFlk([{ payload: Buffer.from("payload"), packed: false }]);
		file.writeUInt32LE(0x1000, INDEX_OFFSET);
		expect(await flkDatFormat.detect(new BufferByteSource(file), "a.dat")).toBe(
			false,
		);
	});
});
