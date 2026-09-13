import { FileByteSource } from "@garbro-mcp/core";
import { digitalWorksPacFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { literalLzssStream } from "../helpers/lzss.js";

const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x20;
const DATA_BIAS = 0x10;

interface Entry {
	name: string;
	payload: Buffer;
	unpackedSize?: number;
}

function lzsContainer(stream: Buffer, declaredSize: number): Buffer {
	const header = Buffer.alloc(8);
	header.write("LZS\0", 0, "ascii");
	header.writeUInt32LE(declaredSize, 4);
	return Buffer.concat([header, stream]);
}

function lzsPayload(content: Buffer, declaredSize = content.length): Buffer {
	return lzsContainer(literalLzssStream(content), declaredSize);
}

/**
 * A payload whose decoded form is an eight-byte header plus a second LZSS stream. The nested marker
 * check runs on the stored stream, which works because a literal-only outer stream starts with its
 * 0xFF control byte followed by the header's `LZS` bytes, matching `(signature & 0xFFFFFF0F)`.
 */
function nestedLzsPayload(content: Buffer): {
	payload: Buffer;
	declaredSize: number;
} {
	const innerStream = literalLzssStream(content);
	const header = Buffer.alloc(8);
	header.write("LZS\0", 0, "ascii");
	header.writeUInt32LE(content.length, 4);
	const outerData = Buffer.concat([header, innerStream]);
	return {
		payload: lzsContainer(literalLzssStream(outerData), outerData.length),
		declaredSize: outerData.length,
	};
}

function buildPac(entries: readonly Entry[]): Buffer {
	const archive = Buffer.alloc(
		DATA_BIAS +
			entries.reduce((total, entry) => total + entry.payload.length, 0),
	);
	archive.write("PPAC-PAC", 0, "ascii");
	let offset = 0;
	for (const entry of entries) {
		entry.payload.copy(archive, DATA_BIAS + offset);
		offset += entry.payload.length;
	}
	return archive;
}

function buildHed(entries: readonly Entry[]): Buffer {
	const stream = Buffer.alloc(INDEX_OFFSET + entries.length * RECORD_SIZE);
	stream.write("PPAC-HED", 0, "ascii");
	let offset = 0;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		stream.write(entry.name, record, "ascii");
		stream.writeUInt32LE(offset, record + 0x10);
		stream.writeUInt32LE(entry.payload.length, record + 0x14);
		offset += entry.payload.length;
	}
	return stream;
}

describe("Digital Works PAC resource archive", () => {
	it("reads a companion hed index and decodes nested LZSS entries", async () => {
		const raw = Buffer.from("stored payload");
		const single = Buffer.from("single lzss payload");
		const nested = Buffer.from("nested lzss payload");
		const nestedEntry = nestedLzsPayload(nested);
		const entries: Entry[] = [
			{ name: "raw.bin", payload: raw },
			{ name: "one.lzs", payload: lzsPayload(single) },
			{ name: "two.lzs", payload: nestedEntry.payload },
		];
		await withCompanionFiles(
			"sample.pac",
			{
				"sample.pac": buildPac(entries),
				"sample.hed": buildHed(entries),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: digitalWorksPacFormat,
					mainPath,
					entries: [
						{ path: "raw.bin", size: raw.length, content: raw },
						{ path: "one.lzs", size: single.length, content: single },
						{
							path: "two.lzs",
							// The entry declares the outer LZSS size; the nested header holds the final size.
							size: nestedEntry.declaredSize,
							content: nested,
						},
					],
					metadata: { entryCount: 3 },
				});
			},
		);
	});

	it("rejects an archive without a hed companion", async () => {
		const entries: Entry[] = [{ name: "raw.bin", payload: Buffer.from("x") }];
		await withCompanionFiles(
			"sample.pac",
			{ "sample.pac": buildPac(entries) },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await digitalWorksPacFormat.detect(source, mainPath)).toBe(
						false,
					);
				} finally {
					await source.close();
				}
			},
		);
	});

	it("rejects a hed file with a foreign signature", async () => {
		const entries: Entry[] = [{ name: "raw.bin", payload: Buffer.from("x") }];
		const hed = buildHed(entries);
		hed.write("XXXX-HED", 0, "ascii");
		await withCompanionFiles(
			"sample.pac",
			{ "sample.pac": buildPac(entries), "sample.hed": hed },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await digitalWorksPacFormat.detect(source, mainPath)).toBe(
						false,
					);
				} finally {
					await source.close();
				}
			},
		);
	});
});
