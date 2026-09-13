import {
	type ArchiveFormat,
	BufferByteSource,
	encodeCp932,
} from "@garbro-mcp/core";
import { crowdPckFormat, crowdPkwvFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const PCK_RECORD_SIZE = 0xc;
const PKWV_FORMAT_SIZE = 0x14;
const PKWV_ENTRY_SIZE = 0x18;

interface File {
	name: string;
	content: Buffer;
}

/** Builds a Crowd resource archive: count, records, NUL-terminated names, then the payloads. */
function buildCrowdPck(files: readonly File[]): Buffer {
	const indexSize = files.length * PCK_RECORD_SIZE;
	const recordsEnd = 4 + indexSize;
	const namesSize = files.reduce(
		(sum, file) => sum + encodeCp932(file.name).length + 1,
		0,
	);
	const dataStart = recordsEnd + namesSize;
	const payloadSize = files.reduce((sum, file) => sum + file.content.length, 0);
	const archive = Buffer.alloc(dataStart + payloadSize);
	archive.writeInt32LE(files.length, 0);
	let payload = dataStart;
	files.forEach((file, id) => {
		const record = 4 + id * PCK_RECORD_SIZE;
		archive.writeUInt32LE(payload, record + 4);
		archive.writeUInt32LE(file.content.length, record + 8);
		payload += file.content.length;
	});
	let name = recordsEnd;
	for (const file of files) {
		const encoded = encodeCp932(file.name);
		encoded.copy(archive, name);
		name += encoded.length + 1;
	}
	payload = dataStart;
	for (const file of files) {
		file.content.copy(archive, payload);
		payload += file.content.length;
	}
	return archive;
}

interface WaveFormat {
	formatTag: number;
	channels: number;
	samplesPerSecond: number;
	averageBytesPerSecond: number;
	bitsPerSample: number;
	blockAlign: number;
}

interface PkwvFile {
	formatIndex: number;
	name: string;
	content: Buffer;
}

/** Builds a Crowd audio archive: the format table, the entry table and the raw PCM payloads. */
function buildCrowdPkwv(
	formats: readonly WaveFormat[],
	files: readonly PkwvFile[],
): Buffer {
	const baseOffset =
		8 + formats.length * PKWV_FORMAT_SIZE + files.length * PKWV_ENTRY_SIZE;
	const payloadSize = files.reduce((sum, file) => sum + file.content.length, 0);
	const archive = Buffer.alloc(baseOffset + payloadSize);
	archive.write("PKWV", 0, "latin1");
	archive.writeUInt16LE(formats.length, 4);
	archive.writeUInt16LE(files.length, 6);
	formats.forEach((format, id) => {
		const record = 8 + id * PKWV_FORMAT_SIZE;
		archive.writeUInt16LE(format.formatTag, record);
		archive.writeUInt16LE(format.channels, record + 2);
		archive.writeUInt32LE(format.samplesPerSecond, record + 4);
		archive.writeUInt32LE(format.averageBytesPerSecond, record + 8);
		archive.writeUInt16LE(format.bitsPerSample, record + 12);
		archive.writeUInt16LE(format.blockAlign, record + 14);
	});
	let payload = baseOffset;
	files.forEach((file, id) => {
		const record = 8 + formats.length * PKWV_FORMAT_SIZE + id * PKWV_ENTRY_SIZE;
		archive.writeUInt16LE(file.formatIndex, record);
		archive.write(file.name, record + 2, "latin1");
		archive.writeUInt32LE(file.content.length, record + 0x0c);
		archive.writeBigInt64LE(BigInt(payload - baseOffset), record + 0x10);
		payload += file.content.length;
	});
	payload = baseOffset;
	for (const file of files) {
		file.content.copy(archive, payload);
		payload += file.content.length;
	}
	return archive;
}

/** Builds the 0x2C-byte RIFF header the reference prepends, with each field written explicitly. */
function expectedRiff(format: WaveFormat, pcmSize: number): Buffer {
	const header = Buffer.alloc(0x2c);
	header.write("RIFF", 0, "latin1");
	header.writeUInt32LE(0x24 + pcmSize, 4);
	header.write("WAVE", 8, "latin1");
	header.write("fmt ", 0x0c, "latin1");
	header.writeUInt32LE(0x10, 0x10);
	header.writeUInt16LE(format.formatTag, 0x14);
	header.writeUInt16LE(format.channels, 0x16);
	header.writeUInt32LE(format.samplesPerSecond, 0x18);
	header.writeUInt32LE(format.averageBytesPerSecond, 0x1c);
	header.writeUInt16LE(format.blockAlign, 0x20);
	header.writeUInt16LE(format.bitsPerSample, 0x22);
	header.write("data", 0x24, "latin1");
	header.writeUInt32LE(pcmSize, 0x28);
	return header;
}

const MONO_16: WaveFormat = {
	formatTag: 1,
	channels: 1,
	samplesPerSecond: 44100,
	averageBytesPerSecond: 88200,
	bitsPerSample: 16,
	blockAlign: 2,
};

const STEREO_8: WaveFormat = {
	formatTag: 1,
	channels: 2,
	samplesPerSecond: 22050,
	averageBytesPerSecond: 22050,
	bitsPerSample: 8,
	blockAlign: 1,
};

describe("Crowd engine resource archive (PCK)", () => {
	it("lists entries whose names follow the records", async () => {
		const first = Buffer.from("first crowd payload");
		const second = Buffer.from("second");
		await expectArchive({
			format: crowdPckFormat,
			archive: buildCrowdPck([
				{ name: "one.bin", content: first },
				{ name: "dir\\two.bin", content: second },
			]),
			entries: [
				{ path: "one.bin", size: first.length, content: first },
				{ path: "dir\\two.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("decodes a multi-byte CP932 name", async () => {
		const content = Buffer.from("cp932 payload");
		await expectArchive({
			format: crowdPckFormat,
			archive: buildCrowdPck([{ name: "テスト.bin", content }]),
			entries: [{ path: "テスト.bin", size: content.length, content }],
		});
	});

	it("rejects a zero count", async () => {
		const archive = buildCrowdPck([{ name: "a", content: Buffer.from("x") }]);
		archive.writeInt32LE(0, 0);
		await expectDeclined(crowdPckFormat, archive);
	});

	it("rejects a count above the hard bound", async () => {
		const archive = buildCrowdPck([{ name: "a", content: Buffer.from("x") }]);
		archive.writeInt32LE(0x100000, 0);
		await expectDeclined(crowdPckFormat, archive);
	});

	it("rejects a payload inside the index size", async () => {
		const archive = buildCrowdPck([{ name: "a", content: Buffer.from("x") }]);
		archive.writeUInt32LE(0, 4 + 4);
		await expectDeclined(crowdPckFormat, archive);
	});

	it("rejects an empty name", async () => {
		const archive = buildCrowdPck([{ name: "a", content: Buffer.from("x") }]);
		archive.writeUInt8(0, 4 + PCK_RECORD_SIZE);
		await expectDeclined(crowdPckFormat, archive);
	});

	it("rejects a name without a terminator in its window", async () => {
		const archive = buildCrowdPck([{ name: "a", content: Buffer.from("x") }]);
		archive.fill(0x41, 4 + PCK_RECORD_SIZE);
		await expectDeclined(crowdPckFormat, archive);
	});

	it("rejects a payload outside the archive", async () => {
		const archive = buildCrowdPck([{ name: "a", content: Buffer.from("x") }]);
		archive.writeUInt32LE(0x1000, 4 + 4);
		await expectDeclined(crowdPckFormat, archive);
	});
});

describe("Crowd engine audio archive (PKWV)", () => {
	it("lists PCM entries and prepends a RIFF header", async () => {
		const first = Buffer.from([1, 2, 3, 4]);
		const second = Buffer.from([5, 6, 7, 8, 9, 10]);
		await expectArchive({
			format: crowdPkwvFormat,
			archive: buildCrowdPkwv(
				[MONO_16, STEREO_8],
				[
					{ formatIndex: 0, name: "one", content: first },
					{ formatIndex: 1, name: "two", content: second },
				],
			),
			sourcePath: "sample.pck",
			entries: [
				{
					path: "one.wav",
					size: first.length + 0x2c,
					content: Buffer.concat([expectedRiff(MONO_16, first.length), first]),
				},
				{
					path: "two.wav",
					size: second.length + 0x2c,
					content: Buffer.concat([
						expectedRiff(STEREO_8, second.length),
						second,
					]),
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects an out-of-range format index", async () => {
		const archive = buildCrowdPkwv(
			[MONO_16],
			[{ formatIndex: 1, name: "one", content: Buffer.alloc(4) }],
		);
		await expectDeclined(crowdPkwvFormat, archive, "sample.pck");
	});

	it("rejects an empty format or entry table", async () => {
		const archive = buildCrowdPkwv([], []);
		await expectDeclined(crowdPkwvFormat, archive, "sample.pck");
	});

	it("rejects a base offset outside the archive", async () => {
		const archive = buildCrowdPkwv(
			[MONO_16],
			[{ formatIndex: 0, name: "one", content: Buffer.alloc(4) }],
		);
		archive.writeUInt16LE(0x200, 4);
		await expectDeclined(crowdPkwvFormat, archive, "sample.pck");
	});

	it("rejects a payload outside the archive", async () => {
		const archive = buildCrowdPkwv(
			[MONO_16],
			[{ formatIndex: 0, name: "one", content: Buffer.alloc(4) }],
		);
		const record = 8 + PKWV_FORMAT_SIZE;
		archive.writeBigInt64LE(0x1000n, record + 0x10);
		await expectDeclined(crowdPkwvFormat, archive, "sample.pck");
	});

	it("rejects a wrong signature", async () => {
		const archive = buildCrowdPkwv(
			[MONO_16],
			[{ formatIndex: 0, name: "one", content: Buffer.alloc(4) }],
		);
		archive.write("XKWV", 0, "latin1");
		await expectDeclined(crowdPkwvFormat, archive, "sample.pck");
	});

	it("rejects a truncated entry table", async () => {
		const archive = buildCrowdPkwv(
			[MONO_16],
			[{ formatIndex: 0, name: "one", content: Buffer.alloc(4) }],
		);
		archive.writeUInt16LE(0x10, 6);
		await expectDeclined(crowdPkwvFormat, archive, "sample.pck");
	});
});

async function expectDeclined(
	format: ArchiveFormat,
	archive: Buffer,
	sourcePath = "sample.bin",
): Promise<void> {
	const source = new BufferByteSource(archive);
	expect(await format.detect(source, sourcePath)).toBe(false);
}

describe("Crowd audio archive details", () => {
	it("keeps the format block align ahead of the sample width in the header", async () => {
		const content = Buffer.alloc(2);
		const source = new BufferByteSource(
			buildCrowdPkwv([STEREO_8], [{ formatIndex: 0, name: "one", content }]),
		);
		const archive = await crowdPkwvFormat.open(source, "sample.pck");
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		const data = await consumeBuffer(await archive.openEntry(entry.id));
		expect(data.subarray(0x20, 0x24)).toEqual(Buffer.from([1, 0, 8, 0]));
		await archive.close();
	});
});
