import { maikaMik01Format } from "@garbro-mcp/formats";
import { encodeCp932 } from "@garbro-mcp/core";
import { describe, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

interface Entry {
	name: string;
	payload: Buffer;
}

function packedEntry(
	signature: "C1" | "E1",
	content: Buffer,
	scheme: "default" | "usg" = "default",
): Buffer {
	const packed = Buffer.from(literalLzssStream(content));
	if (signature === "E1") {
		const pairs: readonly (readonly [number, number])[] =
			scheme === "usg"
				? [
						[7, 13],
						[9, 14],
					]
				: [
						[7, 11],
						[9, 12],
					];
		for (const [left, right] of pairs) {
			const value = packed[left] ?? 0;
			packed[left] = packed[right] ?? 0;
			packed[right] = value;
		}
	}
	const payload = Buffer.alloc(10 + packed.length);
	payload.write(signature, 0, "ascii");
	payload.writeUInt32LE(packed.length, 2);
	packed.copy(payload, 10);
	return payload;
}

function bprContent(header: "BPR01" | "BPR02", control: 1 | 3): Buffer {
	const content = Buffer.alloc(5 + 7);
	content.write(header, 0, "ascii");
	content[5] = control;
	content.writeInt32LE(3, 6);
	content[10] = 0x41;
	content[11] = 0xff;
	return content;
}

function buildMik(
	entries: readonly Entry[],
	signature: "MIK01" | "USG01" = "MIK01",
): Buffer {
	const indexOffset =
		0x10 + entries.reduce((total, entry) => total + entry.payload.length, 0);
	const archive = Buffer.alloc(indexOffset + entries.length * 0x10);
	archive.write(signature, 0, "ascii");
	archive[5] = 0x1a;
	archive.writeInt16LE(entries.length, 8);
	archive.writeUInt32LE(indexOffset, 0x0a);
	let payloadOffset = 0x10;
	for (const [id, entry] of entries.entries()) {
		entry.payload.copy(archive, payloadOffset);
		const record = indexOffset + id * 0x10;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.payload.length, record + 0x0c);
		payloadOffset += entry.payload.length;
	}
	return archive;
}

describe("MAIKA MIK01 resource archive", () => {
	it("extracts raw, LZSS, E1, BPR01, and BPR02 entries", async () => {
		const plain = Buffer.from("plain");
		const lzssOutput = Buffer.from("ordinary compressed payload");
		const e1Output = Buffer.from("default E1 payload");
		const bpr01 = bprContent("BPR01", 1);
		const bpr02 = bprContent("BPR02", 3);
		await expectArchive({
			format: maikaMik01Format,
			archive: buildMik([
				{ name: "raw.bin", payload: plain },
				{ name: "lz.bin", payload: packedEntry("C1", lzssOutput) },
				{ name: "e1.bin", payload: packedEntry("E1", e1Output) },
				{ name: "bpr1.bin", payload: packedEntry("C1", bpr01) },
				{ name: "bpr2.bin", payload: packedEntry("C1", bpr02) },
			]),
			entries: [
				{ path: "raw.bin", size: plain.length, content: plain },
				{
					path: "lz.bin",
					size: packedEntry("C1", lzssOutput).length,
					content: lzssOutput,
				},
				{
					path: "e1.bin",
					size: packedEntry("E1", e1Output).length,
					content: e1Output,
				},
				{
					path: "bpr1.bin",
					size: packedEntry("C1", bpr01).length,
					content: Buffer.from("AAA"),
				},
				{
					path: "bpr2.bin",
					size: packedEntry("C1", bpr02).length,
					content: Buffer.from("AAA"),
				},
			],
			metadata: { entryCount: 5 },
		});
	});

	it("restores the USG01 E1 prefix with the alternate scheme", async () => {
		const content = Buffer.from("USG01 scrambled E1 payload");
		const payload = packedEntry("E1", content, "usg");
		await expectArchive({
			format: maikaMik01Format,
			archive: buildMik([{ name: "e1.bin", payload }], "USG01"),
			entries: [{ path: "e1.bin", size: payload.length, content }],
		});
	});

	it("rejects an index outside the file", async () => {
		const archive = buildMik([{ name: "a", payload: Buffer.from("x") }]);
		archive.writeUInt32LE(archive.length, 0x0a);
		await expectArchive({
			format: maikaMik01Format,
			archive,
			detected: false,
			entries: [],
		});
	});
});
