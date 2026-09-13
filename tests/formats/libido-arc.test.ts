import { encodeCp932 } from "@garbro-mcp/core";
import { libidoArcFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 4;
const NAME_SIZE = 0x14;
const RECORD_SIZE = 0x20;

interface Entry {
	name: string;
	payload: Buffer;
	unpackedSize?: number;
}

function buildArc(entries: readonly Entry[], encrypted = false): Buffer {
	const payloadOffset = INDEX_OFFSET + entries.length * RECORD_SIZE;
	const archive = Buffer.alloc(
		payloadOffset +
			entries.reduce((total, entry) => total + entry.payload.length, 0),
	);
	archive.writeInt32LE(entries.length, 0);
	let offset = payloadOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		const field = Buffer.alloc(NAME_SIZE);
		encodeCp932(entry.name).copy(field);
		if (encrypted) {
			for (let index = 0; index < field.length; index += 1)
				field[index] = (field[index] ?? 0) ^ 0xff;
		}
		field.copy(archive, record);
		archive.writeUInt32LE(
			entry.unpackedSize ?? entry.payload.length,
			record + 0x14,
		);
		archive.writeUInt32LE(entry.payload.length, record + 0x18);
		archive.writeUInt32LE(offset, record + 0x1c);
		entry.payload.copy(archive, offset);
		offset += entry.payload.length;
	}
	return archive;
}

describe("Libido ARC resource archive", () => {
	it("reads stored, encrypted-name, and LZSS entries", async () => {
		await expectArchive({
			format: libidoArcFormat,
			archive: buildArc(
				[
					{ name: "plain.dat", payload: Buffer.from("stored") },
					{
						name: "packed.dat",
						payload: Buffer.from([0x01, 0x41]),
						unpackedSize: 1,
					},
				],
				true,
			),
			sourcePath: "sample.arc",
			entries: [
				{ path: "plain.dat", size: 6, content: Buffer.from("stored") },
				{ path: "packed.dat", size: 1, content: Buffer.from("A") },
			],
		});
	});

	it("rejects a payload that begins inside the header", async () => {
		const archive = Buffer.alloc(40);
		archive.writeInt32LE(1, 0);
		archive.write("a", INDEX_OFFSET, "ascii");
		archive.writeUInt32LE(1, INDEX_OFFSET + 0x14);
		archive.writeUInt32LE(1, INDEX_OFFSET + 0x18);
		archive.writeUInt32LE(1, INDEX_OFFSET + 0x1c);
		await expectArchive({
			format: libidoArcFormat,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});
});
