import { BufferByteSource } from "@garbro-mcp/core";
import { unpackVnsEntry, vnsystemVfsFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_OFFSET = 0x10;
const NAME_SIZE = 0x14;
const RECORD_SIZE = NAME_SIZE + 8;
/** Packed entries keep a four-byte unpacked size in front of the bit stream. */
const PACKED_PREFIX_SIZE = 4;

/** Packs MSB-first bits exactly like GARbro's `MsbBitStream`. */
class MsbBitWriter {
	readonly bytes: number[] = [];
	#bits = 0;
	#count = 0;

	putBit(bit: number): void {
		this.#bits = (this.#bits << 1) | (bit & 1);
		this.#count += 1;
		if (this.#count === 8) {
			this.bytes.push(this.#bits & 0xff);
			this.#bits = 0;
			this.#count = 0;
		}
	}

	put(value: number, length: number): void {
		for (let index = length - 1; index >= 0; index -= 1)
			this.putBit((value >> index) & 1);
	}

	finish(): Buffer {
		if (this.#count > 0) {
			this.bytes.push((this.#bits << (8 - this.#count)) & 0xff);
			this.#bits = 0;
			this.#count = 0;
		}
		return Buffer.from(this.bytes);
	}
}

/** Encodes every byte as a literal token: a clear flag bit followed by eight value bits. */
function encodeLiterals(content: Buffer): Buffer {
	const writer = new MsbBitWriter();
	for (const byte of content) {
		writer.putBit(0);
		writer.put(byte, 8);
	}
	return writer.finish();
}

interface Entry {
	name: string;
	payload: Buffer;
	/** Declared unpacked size for compressed archives. */
	unpacked?: Buffer;
}

function buildVfs(
	entries: readonly Entry[],
	options: { compressed?: boolean } = {},
): Buffer {
	const compressed = options.compressed === true;
	const indexLength = entries.length * RECORD_SIZE;
	const dataOffset = INDEX_OFFSET + indexLength;
	const stored = entries.map((entry) =>
		compressed
			? (() => {
					const prefix = Buffer.alloc(PACKED_PREFIX_SIZE);
					prefix.writeUInt32LE((entry.unpacked ?? entry.payload).length, 0);
					return Buffer.concat([prefix, entry.payload]);
				})()
			: entry.payload,
	);
	const archive = Buffer.alloc(
		dataOffset + stored.reduce((sum, payload) => sum + payload.length, 0),
	);
	archive.write("VFS File", 0, "ascii");
	archive.writeInt32LE(compressed ? 1 : 0, 8);
	archive.writeInt32LE(entries.length, 0xc);
	let payloadOffset = 0;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		Buffer.from(entry.name, "latin1").copy(archive, record, 0, NAME_SIZE - 1);
		archive.writeUInt32LE(payloadOffset, record + NAME_SIZE);
		const payload = stored[id] ?? Buffer.alloc(0);
		archive.writeUInt32LE(payload.length, record + NAME_SIZE + 4);
		payload.copy(archive, dataOffset + payloadOffset);
		payloadOffset += payload.length;
	}
	return archive;
}

describe("VNSystem VFS resource archive", () => {
	it("decodes literal and dictionary tokens", () => {
		// `A` as a literal then a back reference one byte into the dictionary.
		const stream = Buffer.from([0x20, 0xe0]);
		expect(unpackVnsEntry(stream, 2).toString("latin1")).toBe("AA");
	});

	it("reads an uncompressed archive", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		const archive = buildVfs([
			{ name: "first.bin", payload: first },
			{ name: "second.bin", payload: second },
		]);
		await expectArchive({
			format: vnsystemVfsFormat,
			archive,
			metadata: { entryCount: 2 },
			entries: [
				{ path: "first.bin", size: first.length, content: first },
				{ path: "second.bin", size: second.length, content: second },
			],
		});
	});

	it("decodes compressed entries behind their size prefix", async () => {
		const first = Buffer.from("first packed payload");
		const second = Buffer.from("second packed payload");
		const archive = buildVfs(
			[
				{
					name: "first.bin",
					payload: encodeLiterals(first),
					unpacked: first,
				},
				{
					name: "second.bin",
					payload: encodeLiterals(second),
					unpacked: second,
				},
			],
			{ compressed: true },
		);
		await expectArchive({
			format: vnsystemVfsFormat,
			archive,
			entries: [
				{ path: "first.bin", size: first.length, content: first },
				{ path: "second.bin", size: second.length, content: second },
			],
		});
	});

	it("rejects a foreign signature", async () => {
		const archive = buildVfs([
			{ name: "first.bin", payload: Buffer.from("payload") },
		]);
		archive.write("XXXX File", 0, "ascii");
		const source = new BufferByteSource(archive);
		expect(await vnsystemVfsFormat.detect(source)).toBe(false);
	});

	it("rejects an entry that falls outside the archive", async () => {
		const archive = buildVfs([
			{ name: "first.bin", payload: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(0x1000, INDEX_OFFSET + NAME_SIZE);
		const source = new BufferByteSource(archive);
		expect(await vnsystemVfsFormat.detect(source)).toBe(false);
	});

	it("rejects a compressed entry without room for its size prefix", async () => {
		const archive = buildVfs(
			[{ name: "first.bin", payload: Buffer.from("xy") }],
			{ compressed: true },
		);
		archive.writeUInt32LE(2, INDEX_OFFSET + NAME_SIZE + 4);
		const source = new BufferByteSource(archive);
		expect(await vnsystemVfsFormat.detect(source)).toBe(false);
	});
});
