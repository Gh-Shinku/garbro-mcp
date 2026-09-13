import { BufferByteSource } from "@garbro-mcp/core";
import { sohfuSkaFormat, unpackSohfuLzss } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_OFFSET = 8;
const NAME_SIZE = 0x10;
const RECORD_SIZE = 0x18;
const PACKED_HEADER_SIZE = 0xc;

/** Encodes every byte as a literal token under a zero control byte. */
function encodeSohfuLiterals(content: Buffer): Buffer {
	const parts: number[] = [];
	for (let offset = 0; offset < content.length; offset += 8) {
		parts.push(0x00, ...content.subarray(offset, offset + 8));
	}
	return Buffer.from(parts);
}

interface Entry {
	name: string;
	/** Extension stored in the name field after the NUL terminator. */
	extension?: string;
	content: Buffer;
	packed?: boolean;
}

function buildSka(entries: readonly Entry[]): Buffer {
	const indexLength = entries.length * RECORD_SIZE;
	const dataOffset = INDEX_OFFSET + indexLength;
	const stored = entries.map((entry) => {
		if (!entry.packed) return entry.content;
		const header = Buffer.alloc(PACKED_HEADER_SIZE);
		header.write("LS8B", 0, "ascii");
		header.writeUInt32LE(entry.content.length, 4);
		return Buffer.concat([header, encodeSohfuLiterals(entry.content)]);
	});
	const archive = Buffer.alloc(
		dataOffset + stored.reduce((sum, payload) => sum + payload.length, 0),
	);
	archive.write("IPF2", 0, "ascii");
	archive.writeInt32LE(entries.length, 4);
	let payloadOffset = 0;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		const nameField = Buffer.alloc(NAME_SIZE);
		const nameBytes = Buffer.from(entry.name, "latin1");
		if (nameBytes.length >= NAME_SIZE) {
			// A full field has no NUL terminator, so there is no room for an extension.
			nameBytes.subarray(0, NAME_SIZE).copy(nameField, 0);
		} else {
			nameBytes.copy(nameField, 0);
			if (entry.extension !== undefined) {
				Buffer.from(entry.extension, "latin1").copy(
					nameField,
					nameBytes.length + 1,
				);
			}
		}
		nameField.copy(archive, record);
		archive.writeUInt32LE(dataOffset + payloadOffset, record + NAME_SIZE);
		const payload = stored[id] ?? Buffer.alloc(0);
		archive.writeUInt32LE(payload.length, record + NAME_SIZE + 4);
		payload.copy(archive, dataOffset + payloadOffset);
		payloadOffset += payload.length;
	}
	return archive;
}

describe("Sohfu SKA resource archive", () => {
	it("decodes literals and overlapping matches", () => {
		// One literal `A` followed by a distance-0xFFF match of length three.
		const stream = Buffer.from([0x02, 0x41, 0xf0, 0xff]);
		expect(unpackSohfuLzss(stream, 4).toString("latin1")).toBe("AAAA");
	});

	it("reads stored entries and applies the extension field", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		const archive = buildSka([
			{ name: "first", extension: "tga", content: first },
			{ name: "second.dat", content: second },
		]);
		await expectArchive({
			format: sohfuSkaFormat,
			archive,
			metadata: { entryCount: 2 },
			entries: [
				{ path: "first.tga", size: first.length, content: first },
				{ path: "second.dat", size: second.length, content: second },
			],
		});
	});

	it("decodes LS8B payloads behind their header", async () => {
		const content = Buffer.from("packed payload that is longer than a header");
		const archive = buildSka([{ name: "packed.dat", content, packed: true }]);
		await expectArchive({
			format: sohfuSkaFormat,
			archive,
			entries: [{ path: "packed.dat", size: content.length, content }],
		});
	});

	it("keeps a full name field without an extension", async () => {
		const content = Buffer.from("payload");
		const archive = buildSka([{ name: "0123456789abcdef", content }]);
		await expectArchive({
			format: sohfuSkaFormat,
			archive,
			entries: [{ path: "0123456789abcdef", size: content.length, content }],
		});
	});

	it("rejects a foreign signature", async () => {
		const archive = buildSka([
			{ name: "first.dat", content: Buffer.from("payload") },
		]);
		archive.write("XXXX", 0, "ascii");
		const source = new BufferByteSource(archive);
		expect(await sohfuSkaFormat.detect(source)).toBe(false);
	});

	it("rejects an entry that falls outside the archive", async () => {
		const archive = buildSka([
			{ name: "first.dat", content: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(0x1000, INDEX_OFFSET + NAME_SIZE);
		const source = new BufferByteSource(archive);
		expect(await sohfuSkaFormat.detect(source)).toBe(false);
	});
});
