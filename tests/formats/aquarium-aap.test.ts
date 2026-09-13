import { encodeCp932 } from "@garbro-mcp/core";
import { aapFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

/** Encodes `data` with the Cp2 LZ token stream used by Aquarium archives. */
function compressAapLz(data: Buffer): Buffer {
	const tokens: number[] = [];
	let position = 0;
	while (position < data.length) {
		const value = data[position] ?? 0;
		// Try a back-reference of up to 0xFF bytes to earlier output.
		let bestLength = 0;
		let bestOffset = 0;
		for (let offset = 1; offset <= 0xffff && offset <= position; offset += 1) {
			let length = 0;
			while (
				length < 0xff &&
				position + length < data.length &&
				(data[position - offset + length] ?? 0) ===
					(data[position + length] ?? 0)
			) {
				length += 1;
			}
			if (length > bestLength) {
				bestLength = length;
				bestOffset = offset;
			}
		}
		if (bestLength >= 4) {
			tokens.push(0, bestLength, bestOffset & 0xff, bestOffset >> 8);
			position += bestLength;
		} else {
			tokens.push(value);
			position += 1;
		}
	}
	const remaining = tokens.length;
	const header = Buffer.alloc(8);
	header.writeInt32LE(remaining, 0);
	return Buffer.concat([header, Buffer.from(tokens)]);
}

function buildAap(
	entries: { name: string; content: Buffer; packed?: boolean }[],
): Buffer {
	const indexOffset = 0x40;
	const indexSize = entries.length * 0x30;
	const dataOffset = indexOffset + indexSize;
	const payloads = entries.map((entry) =>
		entry.packed ? compressAapLz(entry.content) : entry.content,
	);
	const total =
		dataOffset + payloads.reduce((sum, payload) => sum + payload.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("FPARC10\0", 0, "binary");
	archive.writeUInt32LE(indexOffset, 0x10);
	archive.writeInt32LE(entries.length, 0x14);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x30;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset - dataOffset, record + 0x10);
		archive.writeUInt32LE(
			entry.packed ? entry.content.length : 0,
			record + 0x14,
		);
		const payload = payloads[id] ?? Buffer.alloc(0);
		archive.writeUInt32LE(payload.length, record + 0x18);
		payload.copy(archive, offset);
		offset += payload.length;
	}
	return archive;
}

describe("Aquarium AAP archive", () => {
	it("decompresses Cp2 LZ entries and passes raw entries through", async () => {
		const content = Buffer.from("AAAAAAAAAABBBBBBBBBBCCCC");
		await expectArchive({
			format: aapFormat,
			archive: buildAap([
				{ name: "raw.bin", content: Buffer.from("aa") },
				{ name: "cg.cp2", content, packed: true },
			]),
			entries: [
				{ path: "raw.bin", size: 2, content: Buffer.from("aa") },
				{
					path: "cg.cp2",
					size: compressAapLz(content).length,
					content,
				},
			],
			metadata: { entryCount: 2 },
		});
	});
});
