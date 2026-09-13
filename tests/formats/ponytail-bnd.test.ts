import { BufferByteSource } from "@garbro-mcp/core";
import { ponytailBndFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const COUNT_OFFSET = 0x0d;
const INDEX_OFFSET = 0x0f;
const INDEX_RECORD_SIZE = 0x18;
const MARKER_HEADER_SIZE = 9;

interface Record {
	name: string;
	extension: string;
	payload: Buffer;
}

/**
 * Encodes `data` as literal-only LZ1 output: the mask is read from the least significant bit upwards,
 * so a control byte of 0xFF covers eight literal bytes.
 */
function literalLz1Stream(data: Uint8Array): Buffer {
	const chunks: Uint8Array[] = [];
	for (let offset = 0; offset < data.length; offset += 8)
		chunks.push(Buffer.from([0xff]), data.subarray(offset, offset + 8));
	return Buffer.concat(chunks);
}

/** Builds an archive whose index sits behind the payloads. */
function buildBnd(records: readonly Record[]): Buffer {
	const firstPayload = 0x13;
	const indexOffset = firstPayload + records.reduce(
		(sum, record) => sum + record.payload.length,
		0,
	);
	const header = Buffer.alloc(firstPayload);
	header.write("Bind", 0, "ascii");
	header.write(" ver.0", 4, "ascii");
	header.writeInt16LE(records.length, COUNT_OFFSET);
	header.writeUInt32LE(indexOffset, INDEX_OFFSET);

	const index = Buffer.alloc(records.length * INDEX_RECORD_SIZE);
	let payloadOffset = firstPayload;
	const payloads: Buffer[] = [];
	for (const [id, record] of records.entries()) {
		const record0 = id * INDEX_RECORD_SIZE;
		index.write(record.name, record0, "latin1");
		index.write(record.extension, record0 + 8, "latin1");
		index.writeUInt32LE(record.payload.length, record0 + 0x0c);
		index.writeUInt32LE(payloadOffset, record0 + 0x14);
		payloads.push(record.payload);
		payloadOffset += record.payload.length;
	}
	return Buffer.concat([header, ...payloads, index]);
}

/** A packed payload: the `lz1_` marker, a real extension character and the unpacked size. */
function packedPayload(content: Buffer, extension: string): Buffer {
	const header = Buffer.alloc(MARKER_HEADER_SIZE);
	header.write("lz1_", 0, "ascii");
	header.write(extension, 4, "ascii");
	header.writeUInt32LE(content.length, 5);
	return Buffer.concat([header, literalLz1Stream(content)]);
}

describe("Ponytail BND resource archive", () => {
	it("reads 8.3 names with their extension", async () => {
		const content = Buffer.from("bitmap payload");
		await expectArchive({
			format: ponytailBndFormat,
			archive: buildBnd([
				{ name: "PIC", extension: "BMP", payload: content },
			]),
			entries: [{ path: "PIC.BMP", size: content.length, content }],
		});
	});

	it("decodes a packed entry and recovers its extension", async () => {
		const content = Buffer.from("packed image content");
		await expectArchive({
			format: ponytailBndFormat,
			archive: buildBnd([
				{
					name: "CG0001",
					extension: "Z",
					payload: packedPayload(content, "B"),
				},
			]),
			entries: [{ path: "CG0001.B", size: content.length, content }],
		});
	});

	it("keeps an entry whose name ends in Z but has no marker stored", async () => {
		const content = Buffer.from("raw payload");
		await expectArchive({
			format: ponytailBndFormat,
			archive: buildBnd([
				{ name: "DATA", extension: "Z", payload: content },
			]),
			entries: [{ path: "DATA.Z", size: content.length, content }],
		});
	});

	it("rejects a foreign version string", async () => {
		const archive = buildBnd([
			{ name: "PIC", extension: "BMP", payload: Buffer.alloc(8) },
		]);
		archive.write(" ver.1", 4, "ascii");
		const source = new BufferByteSource(archive);
		expect(await ponytailBndFormat.detect(source)).toBe(false);
	});

	it("rejects a record whose payload falls outside the archive", async () => {
		const archive = buildBnd([
			{ name: "PIC", extension: "BMP", payload: Buffer.alloc(8) },
		]);
		const indexOffset = archive.readUInt32LE(INDEX_OFFSET);
		archive.writeUInt32LE(0x1000, indexOffset + 0x14);
		const source = new BufferByteSource(archive);
		expect(await ponytailBndFormat.detect(source)).toBe(false);
	});
});
