import { BufferByteSource } from "@garbro-mcp/core";
import { daiPacFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const SIGNATURE = "DAI_SYSTEM_01000";
const COUNT_FIELD = 0x10;
const INDEX_SIZE_FIELD = 0x12;
const INDEX_OFFSET = 0x16;
const INDEX_KEY_BIAS = 0x28;
const NAME_TERMINATOR = 0x2c;
const OFFSET_FIELD_SIZE = 5;
const HA0_HEADER_SIZE = 0x10;

interface EntrySpec {
	name: string;
	payload: Buffer;
}

/** The index is stored with a running subtraction over its own position. */
function encryptIndex(plain: Buffer): Buffer {
	const output = Buffer.from(plain);
	for (let position = 0; position < output.length; position += 1)
		output[position] =
			((output[position] ?? 0) + ((position + INDEX_KEY_BIAS) & 0xff)) & 0xff;
	return output;
}

/** Lays out the header, the encrypted index and the payloads. */
function buildPac(
	entries: readonly EntrySpec[],
	declaredIndexSize?: number,
): Buffer {
	const plain: number[] = [];
	const offsets: number[] = [];
	const header = Buffer.alloc(INDEX_OFFSET);
	header.write(SIGNATURE, 0, "latin1");
	header.writeUInt16BE(entries.length, COUNT_FIELD);
	// Every record is its name, a comma, a big-endian offset and one unused byte.
	const recordSize = entries.reduce(
		(sum, entry) => sum + entry.name.length + 1 + OFFSET_FIELD_SIZE,
		0,
	);
	let cursor = INDEX_OFFSET + recordSize;
	for (const entry of entries) {
		offsets.push(cursor);
		cursor += entry.payload.length;
	}
	for (const [id, entry] of entries.entries()) {
		for (const byte of Buffer.from(entry.name, "latin1")) plain.push(byte);
		plain.push(NAME_TERMINATOR);
		const offset = Buffer.alloc(4);
		offset.writeUInt32BE(offsets[id] ?? 0, 0);
		plain.push(...offset, 0);
	}
	const index = encryptIndex(Buffer.from(plain));
	header.writeUInt32BE(declaredIndexSize ?? index.length, INDEX_SIZE_FIELD);
	return Buffer.concat([
		header,
		index,
		...entries.map((entry) => entry.payload),
	]);
}

/** `PacOpener.Decrypt2` reads three interleaved streams, so the stored form interleaves the plain one. */
function interleave3(plain: Buffer): Buffer {
	const output = Buffer.alloc(plain.length);
	let target = 0;
	for (let stream = 0; stream < 3; stream += 1) {
		for (let source = stream; source < plain.length; source += 3)
			output[target++] = plain[source] ?? 0;
	}
	return output;
}

/** `PacOpener.Decrypt3` sums every byte with the ones before it. */
function delta(plain: Buffer): Buffer {
	const output = Buffer.from(plain);
	for (let index = output.length - 1; index > 0; index -= 1)
		output[index] = ((output[index] ?? 0) - (output[index - 1] ?? 0)) & 0xff;
	return output;
}

/** `PacOpener.Unpack4`: literal runs only, one control byte of eight clear bits per group. */
function pack4(plain: Buffer): Buffer {
	const controls: number[] = [];
	const data: number[] = [];
	for (let position = 0; position < plain.length; position += 8) {
		controls.push(0x00);
		for (let step = 0; step < 8 && position + step < plain.length; step += 1)
			data.push(plain[position + step] ?? 0);
	}
	const header = Buffer.alloc(12);
	header.writeInt32BE(plain.length, 0);
	header.writeInt32BE(controls.length, 4);
	header.writeInt32BE(data.length, 8);
	return Buffer.concat([header, Buffer.from(controls), Buffer.from(data)]);
}

/** The pattern bytes are consumed from the most significant one of the little-endian word. */
function patternFor(methods: readonly number[]): number {
	let value = 0;
	for (const [id, method] of methods.entries())
		value |= (method & 0xff) << (8 * (3 - id));
	return value;
}

interface Ha0Spec {
	plain: Buffer;
	methods?: readonly number[];
	headerLength?: number;
	/** Replaces the stream entirely, for cases the encoder helpers cannot express. */
	stream?: Buffer;
}

/** Builds an `HA0` payload whose stream decodes to the plain bytes. */
function buildHa0(spec: Ha0Spec): { payload: Buffer; decoded: Buffer } {
	const methods = spec.methods ?? [];
	const headerLength = spec.headerLength ?? 0;
	let stream = spec.stream ?? Buffer.from(spec.plain);
	if (spec.stream === undefined) {
		// The decoder applies the methods in order, so the stored payload is built backwards.
		for (const method of [...methods].reverse()) {
			if (method === 2) stream = interleave3(stream);
			else if (method === 3) stream = delta(stream);
			else if (method === 4) stream = pack4(stream);
		}
	}
	const header = Buffer.alloc(HA0_HEADER_SIZE + headerLength);
	header.write("HA0", 0, "latin1");
	header.writeUInt8(headerLength, 3);
	header.writeUInt32BE(spec.plain.length, 4);
	header.writeUInt32LE(patternFor(methods), 8);
	return {
		payload: Buffer.concat([header, stream]),
		decoded: spec.stream === undefined ? spec.plain : stream,
	};
}

async function expectDeclined(file: Buffer): Promise<void> {
	expect(
		await daiPacFormat.detect(new BufferByteSource(file), "sample.pac"),
	).toBe(false);
}

describe("DAI_SYSTEM resource archive", () => {
	it("lists entries with adjacent sizes", async () => {
		const first = Buffer.from("first payload bytes");
		const second = Buffer.from("second payload");
		await expectArchive({
			format: daiPacFormat,
			sourcePath: "sample.pac",
			archive: buildPac([
				{ name: "first.dat", payload: first },
				{ name: "second.dat", payload: second },
			]),
			entries: [
				{ path: "first.dat", size: first.length, content: first },
				{ path: "second.dat", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("skips the header of an unprotected image payload", async () => {
		const built = buildHa0({ plain: Buffer.from("image payload bytes") });
		await expectArchive({
			format: daiPacFormat,
			sourcePath: "sample.pac",
			archive: buildPac([{ name: "face.ha0", payload: built.payload }]),
			entries: [
				{
					path: "face.ha0",
					size: built.payload.length - HA0_HEADER_SIZE,
					content: built.decoded,
				},
			],
		});
	});

	it("undoes an interleaved payload", async () => {
		const plain = Buffer.from("interleaved payload contents");
		const built = buildHa0({ plain, methods: [2] });
		expect(built.payload.length).toBe(HA0_HEADER_SIZE + plain.length);
		await expectArchive({
			format: daiPacFormat,
			sourcePath: "sample.pac",
			archive: buildPac([{ name: "packed.ha0", payload: built.payload }]),
			entries: [
				{
					path: "packed.ha0",
					size: plain.length,
					content: plain,
				},
			],
		});
	});

	it("undoes a summed payload", async () => {
		const plain = Buffer.from("summed payload contents");
		const built = buildHa0({ plain, methods: [3] });
		await expectArchive({
			format: daiPacFormat,
			sourcePath: "sample.pac",
			archive: buildPac([{ name: "delta.ha0", payload: built.payload }]),
			entries: [{ path: "delta.ha0", size: plain.length, content: plain }],
		});
	});

	it("unpacks a packed payload", async () => {
		const plain = Buffer.alloc(300, 0x41);
		const built = buildHa0({ plain, methods: [4] });
		await expectArchive({
			format: daiPacFormat,
			sourcePath: "sample.pac",
			archive: buildPac([{ name: "lz.ha0", payload: built.payload }]),
			entries: [
				{
					path: "lz.ha0",
					size: built.payload.length - HA0_HEADER_SIZE,
					content: plain,
				},
			],
		});
	});

	it("walks a two step pipeline", async () => {
		const plain = Buffer.from("pipeline payload contents");
		const built = buildHa0({ plain, methods: [2, 4] });
		await expectArchive({
			format: daiPacFormat,
			sourcePath: "sample.pac",
			archive: buildPac([{ name: "both.ha0", payload: built.payload }]),
			entries: [
				{
					path: "both.ha0",
					size: built.payload.length - HA0_HEADER_SIZE,
					content: plain,
				},
			],
		});
	});

	it("reports an unknown method as a stored payload", async () => {
		const built = buildHa0({
			plain: Buffer.from("x"),
			methods: [7],
			stream: Buffer.from("stored stream"),
		});
		await expectArchive({
			format: daiPacFormat,
			sourcePath: "sample.pac",
			archive: buildPac([{ name: "odd.ha0", payload: built.payload }]),
			entries: [
				{
					path: "odd.ha0",
					size: built.payload.length,
					content: built.payload,
				},
			],
		});
	});

	it("reports a header that covers the payload as stored", async () => {
		const built = buildHa0({
			plain: Buffer.from("ab"),
			methods: [3],
			stream: Buffer.alloc(0),
		});
		await expectArchive({
			format: daiPacFormat,
			sourcePath: "sample.pac",
			archive: buildPac([{ name: "short.ha0", payload: built.payload }]),
			entries: [
				{
					path: "short.ha0",
					size: built.payload.length,
					content: built.payload,
				},
			],
		});
	});

	it("rejects a bad signature", async () => {
		const file = buildPac([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.write("ZZZZ_SYSTEM_01000", 0, "latin1");
		await expectDeclined(file);
	});

	it("rejects an archive without a usable count", async () => {
		const file = buildPac([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.writeUInt16BE(0, COUNT_FIELD);
		await expectDeclined(file);
	});

	it("rejects an index without a name terminator", async () => {
		const file = buildPac([{ name: "first.dat", payload: Buffer.from("x") }]);
		const size = file.readUInt32BE(INDEX_SIZE_FIELD);
		const index = Buffer.from(file.subarray(INDEX_OFFSET, INDEX_OFFSET + size));
		const key = (position: number): number =>
			(position + INDEX_KEY_BIAS) & 0xff;
		for (let position = 0; position < index.length; position += 1)
			index[position] = ((index[position] ?? 0) - key(position)) & 0xff;
		const terminator = index.indexOf(NAME_TERMINATOR);
		expect(terminator).toBeGreaterThanOrEqual(0);
		index[terminator] = 0x2b;
		for (let position = 0; position < index.length; position += 1)
			index[position] = ((index[position] ?? 0) + key(position)) & 0xff;
		index.copy(file, INDEX_OFFSET);
		await expectDeclined(file);
	});
});
