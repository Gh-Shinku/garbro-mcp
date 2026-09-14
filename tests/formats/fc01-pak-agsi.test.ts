import { BufferByteSource } from "@garbro-mcp/core";
import { fc01PakFormat } from "@garbro-mcp/formats";
import { MersenneTwister } from "@garbro-mcp/codecs";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 12;
const RECORD_HEADER_SIZE = 0x10;
const INDEX_SEED = 7524;

/** The inverse of the reference's index transform, so a fixture can carry an encrypted one. */
function encryptIndex(data: Buffer): Buffer {
	const output = Buffer.from(data);
	const random = new MersenneTwister(INDEX_SEED);
	for (let index = 0; index < output.length; index += 1) {
		const key = random.rand() >>> 0;
		const shift = (key & 7) === 0 ? 1 : key & 7;
		const plain = (output[index] ?? 0) ^ (key & 0xff);
		output[index] = ((plain >>> shift) | (plain << (8 - shift))) & 0xff;
	}
	return output;
}

/** The inverse of the reference's header transform, given the two bytes it reads near the end. */
function encryptHeader(header: Buffer, key: number, rotate: number): Buffer {
	const output = Buffer.from(header);
	const shift = (rotate & 7) === 0 ? 1 : rotate & 7;
	for (let index = 0; index < output.length; index += 1) {
		const plain = (output[index] ?? 0) ^ ((key + index) & 0xff);
		output[index] = ((plain >>> shift) | (plain << (8 - shift))) & 0xff;
	}
	return output;
}

/** Builds a literal only lzss stream: one control byte per eight literals, least significant bit first. */
function literalStream(data: Buffer): Buffer {
	const output: number[] = [];
	for (let start = 0; start < data.length; start += 8) {
		const group = data.subarray(start, start + 8);
		let control = 0;
		const body: number[] = [];
		for (const [index, value] of group.entries()) {
			control |= 1 << index;
			body.push(value);
		}
		output.push(control, ...body);
	}
	return Buffer.from(output);
}

/** Packs bits the way the reference's bit stream reads them, most significant bit first. */
function packBits(bits: number[]): Buffer {
	const output: number[] = [];
	for (let start = 0; start < bits.length; start += 8) {
		let byte = 0;
		for (let index = 0; index < 8; index += 1) {
			byte = (byte << 1) | (bits[start + index] ?? 0);
		}
		output.push(byte);
	}
	return Buffer.from(output);
}

/** The bits of one literal and of one match of an offset and a length. */
function literalPlusMatch(
	value: number,
	offset: number,
	length: number,
): number[] {
	const bits = [1];
	for (let bit = 7; bit >= 0; bit -= 1) bits.push((value >> bit) & 1);
	bits.push(0);
	for (let bit = 11; bit >= 0; bit -= 1) bits.push((offset >> bit) & 1);
	for (let bit = 3; bit >= 0; bit -= 1) bits.push(((length - 2) >> bit) & 1);
	return bits;
}

interface RecordSpec {
	name: string;
	unpackedSize: number;
	size: number;
	method: number;
	offset: number;
}

interface PakOptions {
	records?: RecordSpec[];
	data?: Buffer;
	recordSize?: number;
	count?: number;
	/** Turns the header into one the reference has to decrypt first. */
	encryptedHeader?: boolean;
	encryptedIndex?: boolean;
	/** Bytes behind everything the records point at, where the two key bytes can live. */
	trailing?: number;
	signature?: string;
}

function buildPak(options: PakOptions = {}): Buffer {
	const records = options.records ?? [];
	const count = options.count ?? records.length;
	const recordSize = options.recordSize ?? 0x20;
	const data = options.data ?? Buffer.alloc(0);
	const index: Buffer = Buffer.alloc(count * recordSize, 0x00);
	for (const [position, record] of records.entries()) {
		const at = position * recordSize;
		index.writeUInt32LE(record.unpackedSize, at);
		index.writeUInt32LE(record.size, at + 4);
		index.writeInt32LE(record.method, at + 8);
		index.writeUInt32LE(record.offset, at + 0x0c);
		index.write(record.name, at + RECORD_HEADER_SIZE, "latin1");
	}
	const body = Buffer.concat([
		index,
		data,
		Buffer.alloc(options.trailing ?? 0, 0x00),
	]);
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	if (options.encryptedHeader) {
		// Two bytes from the end of the whole file tell the header how to come back.
		const size = HEADER_SIZE + body.length;
		const key = body[size - 9 - HEADER_SIZE] ?? 0;
		const rotate = body[size - 6 - HEADER_SIZE] ?? 0;
		const plain: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
		plain.write("PACK", 0, "ascii");
		plain.writeInt32LE(count, 4);
		plain.writeInt32LE(recordSize, 8);
		encryptHeader(plain, key, rotate).copy(header);
	} else {
		header.write(options.signature ?? "PACK", 0, "latin1");
		header.writeInt32LE(count, 4);
		header.writeInt32LE(recordSize, 8);
	}
	if (options.encryptedIndex) {
		encryptIndex(index).copy(body, 0);
	}
	return Buffer.concat([header, body]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(
	file: Buffer,
	entryIndex = 0,
	name = "data.pak",
): Promise<Buffer> {
	const archive = await fc01PakFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[entryIndex];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("AGSI engine resource archive", () => {
	it("declares its two words and asks to be tried on every file", async () => {
		expect(fc01PakFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("PACK", "ascii") },
			{ bytes: Buffer.from([0x28, 0x20, 0xa0, 0x24]) },
		]);
		expect(fc01PakFormat.detection?.extensionFallback).toBe(true);
		expect(fc01PakFormat.descriptor.extensions).toEqual([]);
		expect(
			await fc01PakFormat.detect(
				sourceOf(
					buildPak({
						records: [
							{ name: "a.dat", unpackedSize: 2, size: 2, method: 0, offset: 0 },
						],
						data: Buffer.from([1, 2]),
					}),
				),
				"data.pak",
			),
		).toBe(true);
		expect(
			await fc01PakFormat.detect(sourceOf(Buffer.alloc(8)), "data.pak"),
		).toBe(false);
	});

	it("reads a plain index with its records and where its data begins", async () => {
		const body = Buffer.from([0xaa, 0xbb, 0xcc]);
		const file = buildPak({
			records: [
				{
					name: "first.dat",
					unpackedSize: 0x800,
					size: 3,
					method: 6,
					offset: 0,
				},
				{
					name: "Copyright.Dat",
					unpackedSize: 9,
					size: 0,
					method: 0,
					// A record of no size at all still has to sit inside the file.
					offset: 0,
				},
			],
			data: body,
			recordSize: 0x20,
		});
		const archive = await fc01PakFormat.open(sourceOf(file), "data.pak");
		try {
			expect(archive.metadata).toEqual({
				entryCount: 2,
				indexEncrypted: false,
			});
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"first.dat",
				"Copyright.Dat",
			]);
			// The data begins where the index ends: twelve bytes of header and two records of 0x20.
			expect(archive.entries[0]?.size).toBe(3n);
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.entries[0]?.metadata).toMatchObject({
				method: 6,
				unpackedSize: 0x800,
			});
			// `Copyright.Dat` is the one name the reference treats specially.
			expect(archive.entries[1]?.metadata).toMatchObject({ special: true });
			expect(archive.entries[1]?.compressed).toBe(false);
		} finally {
			await archive.close();
		}
	});

	it("turns a header and an index back with what the file carries", async () => {
		const plain = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
		const file = buildPak({
			records: [
				{ name: "a.dat", unpackedSize: 8, size: 8, method: 0, offset: 0 },
			],
			data: plain,
			// The two key bytes are the ninth and the sixth from the end of the file.
			trailing: 9,
			encryptedHeader: true,
			encryptedIndex: true,
		});
		const archive = await fc01PakFormat.open(sourceOf(file), "data.pak");
		try {
			expect(archive.metadata).toEqual({ entryCount: 1, indexEncrypted: true });
			expect(archive.entries[0]?.path).toBe("a.dat");
		} finally {
			await archive.close();
		}
		expect(await extract(file)).toEqual(plain);
	});

	it("hands a stored entry over as it stands", async () => {
		const body = Buffer.from([9, 8, 7, 6, 5]);
		const file = buildPak({
			records: [
				{ name: "a.dat", unpackedSize: 5, size: 5, method: 0, offset: 0 },
			],
			data: body,
		});
		expect(await extract(file)).toEqual(body);
	});

	it("unfolds a packed entry through the library's lzss", async () => {
		const plain = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		const packed = literalStream(plain);
		const file = buildPak({
			records: [
				{
					name: "a.dat",
					unpackedSize: plain.length,
					size: packed.length,
					method: 6,
					offset: 0,
				},
			],
			data: packed,
		});
		expect(await extract(file)).toEqual(plain);
	});

	it("unfolds a bit stream of a literal and a match that overlaps itself", async () => {
		// A literal `A` lands at the frame's own first position, one, and a match of three from there runs
		// over what it has just written.
		const packed = packBits(literalPlusMatch(0x41, 1, 3));
		const file = buildPak({
			records: [
				{
					name: "a.dat",
					unpackedSize: 4,
					size: packed.length,
					method: 2,
					offset: 0,
				},
			],
			data: packed,
		});
		expect(await extract(file)).toEqual(Buffer.from([0x41, 0x41, 0x41, 0x41]));
	});

	it("lets a bit stream match run past the size its record declares", async () => {
		const packed = packBits(literalPlusMatch(0x42, 1, 3));
		const file = buildPak({
			records: [
				{
					name: "a.dat",
					unpackedSize: 2,
					size: packed.length,
					// Method two is the plain bit stream; five is the same stream encrypted, which is declined.
					method: 2,
					offset: 0,
				},
			],
			data: packed,
		});
		// The reference stops between pixels rather than inside a match, so the output is longer than asked.
		expect(await extract(file)).toEqual(Buffer.from([0x42, 0x42, 0x42, 0x42]));
	});

	it("refuses a run length entry the reference never implemented", async () => {
		const file = buildPak({
			records: [
				{ name: "a.dat", unpackedSize: 4, size: 2, method: 1, offset: 0 },
			],
			data: Buffer.from([1, 2]),
		});
		await expect(extract(file)).rejects.toThrow(/run length/);
	});

	it("declines an archive that holds an encrypted entry", async () => {
		// The three, four, five and seven methods are encrypted as well as packed, and unwrapping one takes a
		// scheme the reference keeps in a file a user supplies.
		for (const method of [3, 4, 5, 7]) {
			const file = buildPak({
				records: [
					{ name: "a.dat", unpackedSize: 4, size: 4, method, offset: 0 },
				],
				data: Buffer.alloc(4),
			});
			expect(await fc01PakFormat.detect(sourceOf(file), "data.pak")).toBe(
				false,
			);
			await expect(
				fc01PakFormat.open(sourceOf(file), "data.pak"),
			).rejects.toThrow(/layout/);
		}
	});

	it("declines a record with no name, a record size it cannot take and an entry that does not fit", async () => {
		const named = { name: "", unpackedSize: 0, size: 0, method: 0, offset: 0 };
		expect(
			await fc01PakFormat.detect(
				sourceOf(buildPak({ records: [named], data: Buffer.alloc(1) })),
				"data.pak",
			),
		).toBe(false);
		expect(
			await fc01PakFormat.detect(
				sourceOf(
					buildPak({
						records: [
							{ name: "a", unpackedSize: 0, size: 0, method: 0, offset: 0 },
						],
						recordSize: 0x10,
						data: Buffer.alloc(1),
					}),
				),
				"data.pak",
			),
		).toBe(false);
		const beyond = buildPak({
			records: [
				{
					name: "a.dat",
					unpackedSize: 0,
					size: 0x40,
					method: 0,
					offset: 0x200,
				},
			],
			data: Buffer.alloc(4),
		});
		expect(await fc01PakFormat.detect(sourceOf(beyond), "data.pak")).toBe(
			false,
		);
	});
});
