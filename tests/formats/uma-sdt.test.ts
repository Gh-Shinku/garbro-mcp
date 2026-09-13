import { encodeCp932 } from "@garbro-mcp/core";
import { sdtFormat } from "@garbro-mcp/formats";
import { describe, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

interface Entry {
	name: string;
	header: Buffer;
	data: Buffer;
	dataSize?: number;
	packed?: boolean;
}

function buildSdt(entries: readonly Entry[]): Buffer {
	const chunks: Buffer[] = [];
	for (const entry of entries) {
		const dataSize = entry.dataSize ?? entry.data.length;
		const head = Buffer.alloc(8);
		head.writeInt32LE(entry.packed ? 1 : 0, 0);
		head.writeUInt32LE(dataSize, 4);
		const headerSize = Buffer.alloc(4);
		headerSize.writeUInt32LE(entry.header.length, 0);
		chunks.push(
			head,
			encodeCp932(entry.name),
			Buffer.from([0]),
			headerSize,
			entry.header,
			entry.data,
		);
	}
	return Buffer.concat(chunks);
}

/** Mirrors the reference's synthesized RIFF/WAVE stream, including its size bias. */
function expectedWav(entry: Entry, data: Buffer): Buffer {
	const dataSize = entry.dataSize ?? entry.data.length;
	const output = Buffer.alloc(0x14 + entry.header.length + 8 + data.length);
	output.write("RIFF", 0, "ascii");
	output.writeUInt32LE(entry.header.length + dataSize + 0x18, 4);
	output.write("WAVE", 8, "ascii");
	output.write("fmt ", 0x0c, "ascii");
	output.writeUInt32LE(entry.header.length, 0x10);
	entry.header.copy(output, 0x14);
	const trailer = 0x14 + entry.header.length;
	output.write("data", trailer, "ascii");
	output.writeUInt32LE(dataSize, trailer + 4);
	data.copy(output, trailer + 8);
	return output;
}

describe("Uma SDT audio archive", () => {
	it("wraps stored and packed entries in a synthesized RIFF header", async () => {
		const storedHeader = Buffer.from("fmt-block");
		const storedData = Buffer.from("stored samples");
		const lzssHeader = Buffer.from("fmt2");
		const packedData = literalLzssStream(Buffer.from("packed samples"));
		const entries: Entry[] = [
			{
				name: "voice.wav",
				header: storedHeader,
				data: storedData,
			},
			{
				name: "bgm.wav",
				header: lzssHeader,
				data: packedData,
				dataSize: packedData.length,
				packed: true,
			},
		];
		await expectArchive({
			format: sdtFormat,
			archive: buildSdt(entries),
			sourcePath: "sample.sdt",
			entries: [
				{
					path: "voice.wav",
					size: 0x1c + storedHeader.length + storedData.length,
					content: expectedWav(entries[0] as Entry, storedData),
				},
				{
					path: "bgm.wav",
					size: 0x1c + lzssHeader.length + packedData.length,
					content: expectedWav(
						entries[1] as Entry,
						Buffer.from("packed samples"),
					),
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("requires the sdt extension", async () => {
		await expectArchive({
			format: sdtFormat,
			archive: buildSdt([
				{ name: "a.wav", header: Buffer.from("h"), data: Buffer.from("d") },
			]),
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});

	it("rejects a record with a blank name", async () => {
		const archive = buildSdt([
			{ name: "", header: Buffer.from("h"), data: Buffer.from("d") },
		]);
		await expectArchive({
			format: sdtFormat,
			archive,
			sourcePath: "sample.sdt",
			detected: false,
			entries: [],
		});
	});

	it("rejects a record outside the file", async () => {
		const archive = buildSdt([
			{ name: "a.wav", header: Buffer.from("h"), data: Buffer.from("d") },
		]);
		// The data size word sits after the packed flag at the record start.
		archive.writeUInt32LE(archive.length, 4);
		await expectArchive({
			format: sdtFormat,
			archive,
			sourcePath: "sample.sdt",
			detected: false,
			entries: [],
		});
	});
});
