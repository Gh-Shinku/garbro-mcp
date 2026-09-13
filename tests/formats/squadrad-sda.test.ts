import { encodeCp932 } from "@garbro-mcp/core";
import { sdaSdFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 8;
const RECORD_SIZE = 0x14;

/** Writes bits least-significant first, mirroring GARbro's `LsbBitStream`. */
class LsbBitWriter {
	readonly bytes: number[] = [];
	#bits = 0;
	#count = 0;

	push(value: number, count: number): void {
		this.#bits |= value << this.#count;
		this.#count += count;
		while (this.#count >= 8) {
			this.bytes.push(this.#bits & 0xff);
			this.#bits >>>= 8;
			this.#count -= 8;
		}
	}

	finish(): Buffer {
		if (this.#count > 0) this.bytes.push(this.#bits & 0xff);
		return Buffer.from(this.bytes);
	}
}

/** Builds a payload of literal bytes. */
function literals(data: Buffer): Buffer {
	const writer = new LsbBitWriter();
	for (const value of data) {
		writer.push(0, 1);
		writer.push(value, 8);
	}
	const header = Buffer.alloc(4);
	header.writeInt32LE(data.length, 0);
	return Buffer.concat([header, writer.finish()]);
}

/** Builds a payload with one literal and one back-reference. */
function literalThenMatch(
	literal: number,
	offset: number,
	count: number,
): Buffer {
	const writer = new LsbBitWriter();
	writer.push(0, 1);
	writer.push(literal, 8);
	writer.push(1, 1);
	writer.push(0, 1);
	writer.push(offset, 12);
	writer.push(count - 3, 4);
	const header = Buffer.alloc(4);
	header.writeInt32LE(1 + count, 0);
	return Buffer.concat([header, writer.finish()]);
}

interface SdaEntry {
	name: string;
	content: Buffer;
}

function buildSda(entries: readonly SdaEntry[]): Buffer {
	const count = entries.length;
	const dataOffset = INDEX_OFFSET + count * RECORD_SIZE;
	const archive = Buffer.concat([
		Buffer.alloc(dataOffset),
		...entries.map((entry) => entry.content),
	]);
	archive.write("SA\0", 0, "latin1");
	archive.writeInt32LE(dataOffset, 4);
	let offset = 0;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x0c);
		archive.writeUInt32LE(entry.content.length, record + 0x10);
		entry.content.copy(archive, position);
		offset += entry.content.length;
		position += entry.content.length;
	}
	return archive;
}

describe("Squadra D SDA resource archive", () => {
	it("unpacks literal payloads", async () => {
		const first = Buffer.from("first samples");
		const second = Buffer.from("second!");
		await expectArchive({
			format: sdaSdFormat,
			archive: buildSda([
				{ name: "one.bin", content: literals(first) },
				{ name: "two.bin", content: literals(second) },
			]),
			sourcePath: "sample.sda",
			entries: [
				{ path: "one.bin", size: first.length, content: first },
				{ path: "two.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("unpacks back-references from the ring buffer", async () => {
		const expected = Buffer.from("AAAA");
		await expectArchive({
			format: sdaSdFormat,
			archive: buildSda([
				{
					name: "repeat.bin",
					content: literalThenMatch(0x41, 0xfc0, 3),
				},
			]),
			sourcePath: "sample.sda",
			entries: [{ path: "repeat.bin", size: 4, content: expected }],
		});
	});

	it("rejects a missing signature", async () => {
		const archive = buildSda([
			{ name: "a.bin", content: literals(Buffer.from("x")) },
		]);
		archive.write("SB\0", 0, "latin1");
		await expectArchive({
			format: sdaSdFormat,
			archive,
			sourcePath: "sample.sda",
			detected: false,
			entries: [],
		});
	});
});
