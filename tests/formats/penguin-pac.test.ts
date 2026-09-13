import { BufferByteSource } from "@garbro-mcp/core";
import { penguinPacFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_OFFSET = 4;
const RECORD_SIZE = 0xc;
const IKE_HEADER_SIZE = 13;

/** Mirrors the Ike decoder's read order: a 16-bit window followed by the bytes read inside it. */
class IkeWriter {
	readonly out: number[] = [];
	#word = 0;
	#bits = 0;
	#bytes: number[] = [];

	bit(value: number): void {
		this.#word |= (value & 1) << this.#bits;
		this.#bits += 1;
		if (this.#bits === 16) this.#flush();
	}

	byte(value: number): void {
		this.#bytes.push(value & 0xff);
	}

	#flush(): void {
		this.out.push(this.#word & 0xff, (this.#word >> 8) & 0xff, ...this.#bytes);
		this.#word = 0;
		this.#bits = 0;
		this.#bytes = [];
	}

	finish(): Buffer {
		if (this.#bits > 0 || this.#bytes.length > 0) this.#flush();
		return Buffer.from(this.out);
	}
}

function encodeIkeLiterals(content: Buffer): Buffer {
	const writer = new IkeWriter();
	for (const byte of content) {
		writer.bit(1);
		writer.byte(byte);
	}
	return writer.finish();
}

/** The size triplet reads as `b + ((c + (a >> 2 << 8)) << 8)`, so the low byte sits in the middle. */
function encodeIkeSize(size: number): Buffer {
	return Buffer.from([(size >>> 16) << 2, size & 0xff, (size >>> 8) & 0xff]);
}

interface Entry {
	id: number;
	payload: Buffer;
	packed?: boolean;
	declaredSize?: number;
}

function buildPac(entries: readonly Entry[]): Buffer {
	const payloads = entries.map((entry) => {
		if (!entry.packed) return entry.payload;
		const header = Buffer.alloc(IKE_HEADER_SIZE);
		header[2] = 0x69;
		header[3] = 0x6b;
		header[4] = 0x65;
		encodeIkeSize(entry.declaredSize ?? entry.payload.length).copy(header, 10);
		return Buffer.concat([header, entry.payload]);
	});
	const dataOffset = INDEX_OFFSET + entries.length * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset + payloads.reduce((sum, payload) => sum + payload.length, 0),
	);
	archive.writeInt32LE(entries.length, 0);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		const payload = payloads[id] ?? Buffer.alloc(0);
		archive.writeUInt32LE(entry.id, record);
		archive.writeUInt32LE(offset, record + 4);
		archive.writeUInt32LE(payload.length, record + 8);
		payload.copy(archive, offset);
		offset += payload.length;
	}
	return archive;
}

describe("Penguin Works PAC resource archive", () => {
	it("names records after the archive with a known extension", async () => {
		const first = Buffer.from("first image");
		const second = Buffer.from("second image");
		const archive = buildPac([
			{ id: 1, payload: first },
			{ id: 2, payload: second },
		]);
		await expectArchive({
			format: penguinPacFormat,
			archive,
			sourcePath: "/games/VIS.PAC",
			metadata: { entryCount: 2 },
			entries: [
				{ path: "VIS0001.BMP", size: first.length, content: first },
				{ path: "VIS0002.BMP", size: second.length, content: second },
			],
		});
	});

	it("omits the extension for an unknown archive kind", async () => {
		const payload = Buffer.from("payload");
		const archive = buildPac([{ id: 7, payload }]);
		await expectArchive({
			format: penguinPacFormat,
			archive,
			sourcePath: "/games/MISC.PAC",
			entries: [{ path: "MISC0007", size: payload.length, content: payload }],
		});
	});

	it("decodes packed entries behind the ike header", async () => {
		const content = Buffer.from("packed payload");
		const archive = buildPac([
			{
				id: 3,
				payload: encodeIkeLiterals(content),
				packed: true,
				declaredSize: content.length,
			},
		]);
		await expectArchive({
			format: penguinPacFormat,
			archive,
			sourcePath: "/games/EFT.PAC",
			entries: [{ path: "EFT0003.WAV", size: content.length, content }],
		});
	});

	it("requires the pac extension", async () => {
		const archive = buildPac([{ id: 1, payload: Buffer.from("payload") }]);
		const source = new BufferByteSource(archive);
		expect(await penguinPacFormat.detect(source, "/games/VIS.bin")).toBe(false);
		expect(await penguinPacFormat.detect(source, "/games/VIS.pac")).toBe(true);
	});

	it("rejects an out-of-range payload", async () => {
		const archive = buildPac([{ id: 1, payload: Buffer.from("payload") }]);
		archive.writeUInt32LE(0x1000, INDEX_OFFSET + 4);
		const source = new BufferByteSource(archive);
		expect(await penguinPacFormat.detect(source, "/games/VIS.pac")).toBe(false);
	});

	it("rejects an implausible record count", async () => {
		const archive = buildPac([{ id: 1, payload: Buffer.from("payload") }]);
		archive.writeInt32LE(0, 0);
		const source = new BufferByteSource(archive);
		expect(await penguinPacFormat.detect(source, "/games/VIS.pac")).toBe(false);
	});
});
