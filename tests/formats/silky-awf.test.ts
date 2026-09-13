import { encodeCp932 } from "@garbro-mcp/core";
import { awfFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 4;
const RECORD_SIZE = 0x34;
const NAME_SIZE = 0x20;
const WAV_HEADER_SIZE = 0x2c;

interface AwfEntry {
	name: string;
	content: Buffer;
}

function buildAwf(entries: readonly AwfEntry[]): Buffer {
	const count = entries.length;
	const dataOffset = INDEX_OFFSET + count * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeInt32LE(count, 0);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + NAME_SIZE);
		archive.writeUInt32LE(entry.content.length, record + NAME_SIZE + 4);
		entry.content.copy(archive, position);
		offset += entry.content.length;
		position += entry.content.length;
	}
	return archive;
}

/** Builds the fixed header GARbro writes in front of raw payloads. */
function wavHeader(dataSize: number): Buffer {
	const header = Buffer.alloc(WAV_HEADER_SIZE);
	header.write("RIFF", 0, "ascii");
	header.writeUInt32LE(dataSize + (WAV_HEADER_SIZE - 8), 4);
	header.write("WAVE", 8, "ascii");
	header.write("fmt ", 12, "ascii");
	header.writeUInt32LE(0x10, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(2, 22);
	header.writeUInt32LE(22050, 24);
	header.writeUInt32LE(22050 * 4, 28);
	header.writeUInt16LE(4, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36, "ascii");
	header.writeUInt32LE(dataSize, 40);
	return header;
}

describe("Silky's AWF audio archive", () => {
	it("reads records and generates WAV headers", async () => {
		const first = Buffer.from("pcm payload");
		const second = Buffer.from("more pcm");
		await expectArchive({
			format: awfFormat,
			archive: buildAwf([
				{ name: "bgm01", content: first },
				{ name: "se02", content: second },
			]),
			sourcePath: "sound.awf",
			entries: [
				{
					path: "bgm01",
					size: first.length + WAV_HEADER_SIZE,
					content: Buffer.concat([wavHeader(first.length), first]),
				},
				{
					path: "se02",
					size: second.length + WAV_HEADER_SIZE,
					content: Buffer.concat([wavHeader(second.length), second]),
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("keeps MP3 payloads untouched for voice.awf", async () => {
		const content = Buffer.from("ID3 mp3 data");
		await expectArchive({
			format: awfFormat,
			archive: buildAwf([{ name: "voice001", content }]),
			sourcePath: "/games/voice.awf",
			entries: [{ path: "voice001.mp3", size: content.length, content }],
		});
	});

	it("requires the awf extension", async () => {
		await expectArchive({
			format: awfFormat,
			archive: buildAwf([{ name: "a", content: Buffer.from("x") }]),
			sourcePath: "sound.bin",
			detected: false,
			entries: [],
		});
	});
});
