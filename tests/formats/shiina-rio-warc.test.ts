import { BufferByteSource } from "@garbro-mcp/core";
import { shiinaRioWarcFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const SIGNATURE = "WARC 1.0";
const STREAM_KEY = 0xe6;
const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x18;

/** Encodes a packed payload the way the reference decoder reads it. */
class YlzWriter {
	readonly #tokens: Array<{ kind: "bit" | "byte"; value: number }> = [];

	#bit(value: number): void {
		this.#tokens.push({ kind: "bit", value: value & 1 });
	}

	#byte(value: number): void {
		this.#tokens.push({ kind: "byte", value: value & 0xff });
	}

	/**
	 * The reference reads one control bit before it loads its first word. That bit comes from an empty control
	 * word, so it is a phantom bit that never reaches the stream: the first stored bit is the first flag.
	 */
	prime(): this {
		return this;
	}

	literal(value: number): this {
		this.#bit(1);
		this.#byte(value);
		return this;
	}

	shortMatch(distance: number, count: number): this {
		this.#bit(0);
		this.#bit(0);
		const encoded = count - 2;
		this.#bit((encoded >> 1) & 1);
		this.#bit(encoded & 1);
		this.#byte((0x100 - distance) & 0xff);
		return this;
	}

	/** A long match whose count rides in the low three bits of the second distance byte. */
	longMatch(distance: number, count: number): this {
		const payload = 0x2000 - distance;
		this.#bit(0);
		this.#bit(1);
		this.#byte(payload & 0xff);
		this.#byte(((payload & 0x1f00) >> 5) | (count - 2));
		return this;
	}

	/** A long match with an extended count, where a zero count byte ends the stream. */
	extendedMatch(distance: number, count: number | 0): this {
		const payload = 0x2000 - distance;
		this.#bit(0);
		this.#bit(1);
		this.#byte(payload & 0xff);
		this.#byte((payload & 0x1f00) >> 5);
		this.#byte(count === 0 ? 0 : count - 9);
		return this;
	}

	/**
	 * Lays the tokens out the way the decoder walks them: control words and payload bytes share one cursor, and
	 * a word is read whenever the sixteen bits of the previous one are used up.
	 */
	finish(): Buffer {
		const bits = this.#tokens
			.filter((token) => token.kind === "bit")
			.map((token) => token.value);
		const output: number[] = [];
		let bitCursor = 0;
		let available = 0;
		for (const token of this.#tokens) {
			if (token.kind === "byte") {
				output.push(token.value);
				continue;
			}
			if (available === 0) {
				let word = 0;
				for (let i = 0; i < 16; i += 1) word |= (bits[bitCursor++] ?? 0) << i;
				available = 16;
				output.push(word & 0xff, (word >> 8) & 0xff);
			}
			available -= 1;
		}
		const stream = Buffer.from(output);
		for (let i = 0; i < stream.length; i += 1)
			stream[i] = ((stream[i] ?? 0) ^ STREAM_KEY) & 0xff;
		return stream;
	}
}

interface Fixture {
	name: string;
	stored: Buffer;
	unpacked?: number;
}

/** Builds an archive whose payloads come first and whose index sits at the declared offset. */
function buildArchive(fixtures: readonly Fixture[]): Buffer {
	const payloads: Buffer[] = [];
	let payloadOffset = INDEX_OFFSET;
	const records = fixtures.map((fixture) => {
		const record = Buffer.alloc(RECORD_SIZE);
		Buffer.from(fixture.name, "latin1").copy(record, 0, 0, RECORD_SIZE - 1);
		record.writeUInt32LE(payloadOffset, 0x10);
		record.writeUInt32LE(fixture.stored.length, 0x14);
		payloads.push(fixture.stored);
		payloadOffset += fixture.stored.length;
		return record;
	});
	const index = Buffer.concat(records);
	for (let i = 0; i < index.length; i += 2) {
		index[i] = ((index[i] ?? 0) ^ 0xfe) & 0xff;
		index[i + 1] = ((index[i + 1] ?? 0) ^ 0xe5) & 0xff;
	}
	const header = Buffer.alloc(INDEX_OFFSET);
	Buffer.from(SIGNATURE, "latin1").copy(header, 0);
	header.writeUInt32LE(payloadOffset, 8);
	return Buffer.concat([header, ...payloads, index]);
}

/** Wraps a packed stream in the marker and unpacked size a packed payload carries. */
function packedPayload(stream: Buffer, unpackedSize: number): Buffer {
	const header = Buffer.alloc(8);
	header.write("Ylz", 0, "latin1");
	header.writeUInt32LE(unpackedSize, 4);
	return Buffer.concat([header, stream]);
}

async function expectDeclined(archive: Buffer): Promise<void> {
	const source = new BufferByteSource(archive);
	expect(await shiinaRioWarcFormat.detect(source, "sample.war")).toBe(false);
}

describe("ShiinaRio engine resource archive", () => {
	it("lists a stored payload and unpacks short matches", async () => {
		const raw = Buffer.from("stored payload");
		const unpacked = Buffer.from("ABCABC");
		const writer = new YlzWriter().prime();
		for (const byte of Buffer.from("ABC")) writer.literal(byte);
		writer.shortMatch(3, 3);
		const archive = buildArchive([
			{ name: "raw.bin", stored: raw },
			{
				name: "packed.bin",
				stored: packedPayload(writer.finish(), unpacked.length),
				unpacked: unpacked.length,
			},
		]);
		await expectArchive({
			format: shiinaRioWarcFormat,
			archive,
			entries: [
				{ path: "raw.bin", size: raw.length, content: raw },
				{ path: "packed.bin", size: unpacked.length, content: unpacked },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("unpacks a long match with an extended count", async () => {
		const unpacked = Buffer.from(`A${"A".repeat(10)}`);
		const writer = new YlzWriter().prime();
		writer.literal(0x41);
		writer.extendedMatch(1, 10);
		const archive = buildArchive([
			{
				name: "repeat.bin",
				stored: packedPayload(writer.finish(), unpacked.length),
				unpacked: unpacked.length,
			},
		]);
		await expectArchive({
			format: shiinaRioWarcFormat,
			archive,
			entries: [
				{ path: "repeat.bin", size: unpacked.length, content: unpacked },
			],
		});
	});

	it("keeps the trailing zeroes of a stream that ends early", async () => {
		const writer = new YlzWriter().prime();
		writer.literal(0x41);
		writer.extendedMatch(1, 0);
		const unpacked = Buffer.from(`A${"\0".repeat(3)}`);
		const archive = buildArchive([
			{
				name: "short.bin",
				stored: packedPayload(writer.finish(), unpacked.length),
				unpacked: unpacked.length,
			},
		]);
		await expectArchive({
			format: shiinaRioWarcFormat,
			archive,
			entries: [
				{ path: "short.bin", size: unpacked.length, content: unpacked },
			],
		});
	});

	it("rejects a file without the format signature", async () => {
		const archive = buildArchive([
			{ name: "raw.bin", stored: Buffer.from("payload") },
		]);
		archive.write("WARC 2.0", 0, "latin1");
		await expectDeclined(archive);
	});

	it("rejects an index offset outside the file", async () => {
		const archive = buildArchive([
			{ name: "raw.bin", stored: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(0x4000, 8);
		await expectDeclined(archive);
	});

	it("rejects an index region that is not made of record pairs", async () => {
		const archive = buildArchive([
			{ name: "raw.bin", stored: Buffer.from("payload") },
		]);
		await expectDeclined(Buffer.concat([archive, Buffer.from([0])]));
	});

	it("rejects an archive without records", async () => {
		await expectDeclined(buildArchive([]));
	});
});
