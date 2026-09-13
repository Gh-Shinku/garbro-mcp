import {
	buildRiffHeader,
	wsm0Format,
	wsm1Format,
	wsm2Format,
	wsm4Format,
} from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const V0_INDEX_OFFSET = 0x10;
const V2_INDEX_OFFSET = 0x40;
const V4_NAME_OFFSET = 0x44;

/** Versions zero and one span the file's first `index_size` bytes, and each pointer names a record in it. */
function buildWsm01(
	signature: string,
	name: string,
	payload: Buffer,
	format: { channels: number; bits: number; rate: number } | undefined,
): Buffer {
	const indexSize = 0x40;
	const archive = Buffer.alloc(indexSize + payload.length);
	archive.write(signature, 0, "ascii");
	archive.writeUInt32LE(indexSize, 4);
	archive.writeInt32LE(1, 8);
	archive.writeInt32LE(0x20, V0_INDEX_OFFSET);
	// The record: a name length that includes its terminator, the name, then the format and both words.
	const recordStart = 0x20;
	const nameLength = name.length + 1;
	archive.writeUInt8(nameLength, recordStart);
	archive.write(name, recordStart + 1, "latin1");
	const fields = recordStart + nameLength;
	if (format) {
		archive.writeUInt8(format.channels, fields + 2);
		archive.writeUInt8(format.bits, fields + 3);
		archive.writeUInt32LE(format.rate, fields + 4);
	}
	archive.writeUInt32LE(indexSize, fields + 8);
	archive.writeUInt32LE(payload.length, fields + 12);
	payload.copy(archive, indexSize);
	return archive;
}

describe("Tanaka WSM music archives", () => {
	it("reads version zero with its default wave format", async () => {
		const payload = Buffer.from("audio body");
		const format = { channels: 2, bitsPerSample: 16, samplesPerSecond: 44100 };
		await expectArchive({
			format: wsm0Format,
			archive: buildWsm01("WSM0", "song", payload, undefined),
			sourcePath: "sample.wsm",
			entries: [
				{
					path: "song.wav",
					size: payload.length,
					content: Buffer.concat([
						buildRiffHeader(format, payload.length),
						payload,
					]),
				},
			],
		});
	});

	it("reads version one with a per-entry wave format", async () => {
		const payload = Buffer.from("mono body");
		const format = { channels: 1, bitsPerSample: 8, samplesPerSecond: 22050 };
		await expectArchive({
			format: wsm1Format,
			archive: buildWsm01("WSM1", "voice", payload, {
				channels: 1,
				bits: 8,
				rate: 22050,
			}),
			sourcePath: "sample.wsm",
			entries: [
				{
					path: "voice.wav",
					size: payload.length,
					content: Buffer.concat([
						buildRiffHeader(format, payload.length),
						payload,
					]),
				},
			],
		});
	});

	it("reads version two through its bias-adjusted table and name records", async () => {
		const payload = Buffer.alloc(0x20, 0x31);
		const indexSize = 0x40;
		const archive = Buffer.alloc(V2_INDEX_OFFSET + indexSize + payload.length);
		archive.write("WSM2", 0, "ascii");
		archive.writeUInt32LE(indexSize, 4);
		archive.writeInt32LE(1, 0x0c);
		archive.writeInt32LE(0x20, 0x10);
		archive.writeInt32LE(1, 0x14);
		const index = V2_INDEX_OFFSET;
		// The reader subtracts a fixed 0x14 from the table's offset word and adds it back to its size word.
		archive.writeUInt32LE(V2_INDEX_OFFSET + indexSize + 0x14, index + 0x20);
		archive.writeUInt32LE(payload.length - 0x14, index + 0x28);
		// The name record points at a name whose entry index says which table record it names.
		const namePosition = 0x30;
		archive.writeInt32LE(namePosition, index);
		const name = "song";
		archive.writeUInt8(name.length + 2, index + namePosition + 1);
		archive.write(name, index + namePosition + 2, "latin1");
		archive.writeUInt8(0, index + namePosition + name.length + 2 + 3);
		payload.copy(archive, V2_INDEX_OFFSET + indexSize);
		await expectArchive({
			format: wsm2Format,
			archive,
			sourcePath: "sample.wsm",
			entries: [{ path: "song.wav", size: payload.length, content: payload }],
		});
	});

	it("reads version four through its table and name stride", async () => {
		const payload = Buffer.from("fourth body");
		const tableOffset = 0x80;
		const archive = Buffer.alloc(V4_NAME_OFFSET + 0x1a8 + payload.length);
		archive.write("WSM4", 0, "ascii");
		// The data offset marks where payloads begin, and it must stay inside the file.
		archive.writeUInt32LE(archive.length - payload.length, 4);
		archive.writeInt32LE(1, 0x0c);
		archive.writeInt32LE(tableOffset, 0x10);
		archive.writeInt32LE(1, 0x14);
		archive.writeUInt32LE(archive.length - payload.length, tableOffset);
		archive.writeUInt32LE(payload.length, tableOffset + 4);
		archive.write("fourth", V4_NAME_OFFSET, "latin1");
		payload.copy(archive, archive.length - payload.length);
		await expectArchive({
			format: wsm4Format,
			archive,
			sourcePath: "sample.wsm",
			entries: [{ path: "fourth", size: payload.length, content: payload }],
		});
	});

	it("rejects a version two name that points past the table", async () => {
		const payload = Buffer.alloc(0x20, 0x32);
		const indexSize = 0x40;
		const archive = Buffer.alloc(V2_INDEX_OFFSET + indexSize + payload.length);
		archive.write("WSM2", 0, "ascii");
		archive.writeUInt32LE(indexSize, 4);
		archive.writeInt32LE(1, 0x0c);
		archive.writeInt32LE(0x20, 0x10);
		archive.writeInt32LE(1, 0x14);
		archive.writeUInt32LE(
			V2_INDEX_OFFSET + indexSize + 0x14,
			V2_INDEX_OFFSET + 0x20,
		);
		archive.writeUInt32LE(payload.length - 0x14, V2_INDEX_OFFSET + 0x28);
		archive.writeInt32LE(0x30, V2_INDEX_OFFSET);
		archive.writeUInt8(6, V2_INDEX_OFFSET + 0x31);
		archive.write("song", V2_INDEX_OFFSET + 0x32, "latin1");
		archive.writeUInt8(9, V2_INDEX_OFFSET + 0x30 + 6 + 3);
		payload.copy(archive, V2_INDEX_OFFSET + indexSize);
		await expectArchive({
			format: wsm2Format,
			archive,
			sourcePath: "sample.wsm",
			detected: false,
			entries: [],
		});
	});

	it("rejects a version four table smaller than its count", async () => {
		const payload = Buffer.from("body");
		const archive = Buffer.alloc(V4_NAME_OFFSET + 0x1a8 + payload.length);
		archive.write("WSM4", 0, "ascii");
		archive.writeUInt32LE(archive.length, 4);
		archive.writeInt32LE(2, 0x0c);
		archive.writeInt32LE(0x80, 0x10);
		archive.writeInt32LE(1, 0x14);
		await expectArchive({
			format: wsm4Format,
			archive,
			sourcePath: "sample.wsm",
			detected: false,
			entries: [],
		});
	});
});
