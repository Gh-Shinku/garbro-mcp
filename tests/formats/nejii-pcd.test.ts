import { encodeCp932 } from "@garbro-mcp/core";
import { pcdFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const DATA_OFFSET = 0x20;
const WAV_HEADER_SIZE = 40;

/** Builds a wave format block: PCM, two channels, 22050 Hz, 16 bits. */
function waveFormat(): Buffer {
	const format = Buffer.alloc(0x10);
	format.writeUInt16LE(1, 0);
	format.writeUInt16LE(2, 2);
	format.writeUInt32LE(22050, 4);
	format.writeUInt32LE(22050 * 4, 8);
	format.writeUInt16LE(4, 12);
	format.writeUInt16LE(16, 14);
	return format;
}

/** The stored payload starts with its own 32-bit size word, which GARbro keeps in the entry. */
function pcdPayload(body: Buffer): Buffer {
	const payload = Buffer.alloc(4, 0);
	payload.writeUInt32LE(body.length, 0);
	return Buffer.concat([payload, body]);
}

/** Builds the 40-byte RIFF header GARbro writes for PCD payloads. */
function pcdWavHeader(entrySize: number): Buffer {
	const header = Buffer.alloc(WAV_HEADER_SIZE);
	header.writeUInt32LE(0x46464952, 0);
	header.writeUInt32LE(entrySize + 0x20, 4);
	header.writeUInt32LE(0x45564157, 8);
	header.writeUInt32LE(0x20746d66, 12);
	header.writeUInt32LE(0x10, 16);
	waveFormat().copy(header, 20);
	header.writeUInt32LE(0x61746164, 36);
	return header;
}

function buildPcd(entries: readonly { name: string; body: Buffer }[]): Buffer {
	const parts = entries.map((entry) => {
		const header = Buffer.alloc(DATA_OFFSET);
		encodeCp932(entry.name).copy(header, 0);
		// The wave format of the first record is what the opener validates.
		waveFormat().copy(header, 0x10);
		return Buffer.concat([header, pcdPayload(entry.body)]);
	});
	return Buffer.concat(parts);
}

describe("NEJII PCD resource archive", () => {
	it("reads chained records with wave format validation", async () => {
		const first = pcdPayload(Buffer.from("pcm one"));
		const second = pcdPayload(Buffer.from("pcm two"));
		await expectArchive({
			format: pcdFormat,
			archive: buildPcd([
				{ name: "voice01", body: Buffer.from("pcm one") },
				{ name: "voice02", body: Buffer.from("pcm two") },
			]),
			sourcePath: "sound.pcd",
			entries: [
				{
					path: "voice01",
					size: first.length + WAV_HEADER_SIZE,
					content: Buffer.concat([
						pcdWavHeader(first.length + WAV_HEADER_SIZE),
						first,
					]),
				},
				{
					path: "voice02",
					size: second.length + WAV_HEADER_SIZE,
					content: Buffer.concat([
						pcdWavHeader(second.length + WAV_HEADER_SIZE),
						second,
					]),
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects mismatched byte rate and block alignment", async () => {
		const archive = buildPcd([{ name: "a", body: Buffer.from("x") }]);
		archive.writeUInt32LE(1, 0x18);
		await expectArchive({
			format: pcdFormat,
			archive,
			sourcePath: "sound.pcd",
			detected: false,
			entries: [],
		});
	});

	it("requires the pcd extension", async () => {
		await expectArchive({
			format: pcdFormat,
			archive: buildPcd([{ name: "a", body: Buffer.from("x") }]),
			sourcePath: "sound.bin",
			detected: false,
			entries: [],
		});
	});
});
