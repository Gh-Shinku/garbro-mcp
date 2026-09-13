import { BufferByteSource } from "@garbro-mcp/core";
import { lazycrewDatFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";

const DIR_RECORD_SIZE = 0x10;
const DIR_FIRST_OFFSET = 4;
const ENTRY_RECORD_SIZE = 10;
const PCM_KEY = 0x4b5ab4a5;

interface IndexSpec {
	name: string;
	entries: { volume: number; payload: Buffer }[];
}

/** Mirrors the reference encryption, the inverse of the rolling key transform it applies on read. */
function encryptPcm(data: Buffer): Buffer {
	const output = Buffer.from(data);
	let state = PCM_KEY;
	for (let position = 0; position < output.length; position += 1) {
		const plain = output[position] ?? 0;
		output[position] = plain ^ (state & 0xff);
		state = (plain ^ (((state << 9) >>> 0) | ((state >>> 23) & 0x1f0))) >>> 0;
	}
	return output;
}

/** Builds a PCM record with the layout the reference expects: format at 4, data size at 0x16, PCM at 0x1A. */
function buildAudioRecord(
	signature: number,
	pcm: Buffer,
	format: Buffer,
): Buffer {
	const record = Buffer.alloc(0x1a + pcm.length);
	record.writeUInt32LE(signature, 0);
	format.copy(record, 4);
	record.writeUInt32LE(pcm.length, 0x16);
	encryptPcm(pcm).copy(record, 0x1a);
	return record;
}

function expectedRiff(format: Buffer, pcm: Buffer): Buffer {
	const header = Buffer.alloc(0x2c);
	header.write("RIFF", 0, "latin1");
	header.writeUInt32LE(0x24 + pcm.length, 4);
	header.write("WAVE", 8, "latin1");
	header.write("fmt ", 12, "latin1");
	header.writeUInt32LE(0x10, 16);
	format.copy(header, 20);
	header.write("data", 0x24, "latin1");
	header.writeUInt32LE(pcm.length, 0x28);
	return Buffer.concat([header, pcm]);
}

interface Built {
	index: Buffer;
	volumes: Map<number, Buffer>;
}

/** Lays out the index and the per-volume payload areas, recording offsets relative to `volumeBase`. */
function buildArchive(specs: readonly IndexSpec[], volumeBase = 0): Built {
	const firstOffset = DIR_FIRST_OFFSET + DIR_RECORD_SIZE * specs.length;
	const totalRecords = specs.reduce(
		(sum, spec) => sum + spec.entries.length,
		0,
	);
	const index = Buffer.alloc(firstOffset + ENTRY_RECORD_SIZE * totalRecords);
	index.writeInt32LE(specs.length, 0);
	const volumes = new Map<number, Buffer[]>();
	let recordOffset = firstOffset;
	for (const [dirId, spec] of specs.entries()) {
		const base = DIR_FIRST_OFFSET + dirId * DIR_RECORD_SIZE;
		index.write(spec.name, base, "latin1");
		index.writeInt32LE(recordOffset, base + 8);
		index.writeInt32LE(spec.entries.length, base + 12);
		for (const entry of spec.entries) {
			const chunks = volumes.get(entry.volume) ?? [];
			const offset =
				volumeBase + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
			index.writeUInt16LE(entry.volume, recordOffset);
			index.writeUInt32LE(offset, recordOffset + 2);
			index.writeUInt32LE(entry.payload.length, recordOffset + 6);
			chunks.push(entry.payload);
			volumes.set(entry.volume, chunks);
			recordOffset += ENTRY_RECORD_SIZE;
		}
	}
	const built = new Map<number, Buffer>();
	for (const [volume, chunks] of volumes)
		built.set(volume, Buffer.concat(chunks));
	return { index, volumes: built };
}

/** Payloads of the first volume live behind its index inside the same file. */
function singleFile(specs: readonly IndexSpec[], volume = 1): Buffer {
	const firstOffset = DIR_FIRST_OFFSET + DIR_RECORD_SIZE * specs.length;
	const totalRecords = specs.reduce(
		(sum, spec) => sum + spec.entries.length,
		0,
	);
	const indexLength = firstOffset + ENTRY_RECORD_SIZE * totalRecords;
	const built = buildArchive(specs, indexLength);
	const data = built.volumes.get(volume);
	if (!data) throw new Error("missing volume");
	return Buffer.concat([built.index, data]);
}

function requireVolume(built: Built, volume: number): Buffer {
	const data = built.volumes.get(volume);
	if (!data) throw new Error(`missing volume ${volume}`);
	return data;
}

describe("Lazycrew resource archive", () => {
	it("reads the index of the first volume", async () => {
		const image = Buffer.from("image payload");
		const sound = Buffer.from("sound payload");
		await expectArchive({
			format: lazycrewDatFormat,
			sourcePath: "0001.dat",
			archive: singleFile([
				{
					name: "image",
					entries: [
						{ volume: 1, payload: image },
						{ volume: 1, payload: sound },
					],
				},
			]),
			entries: [
				{ path: "image/00000", size: image.length, content: image },
				{ path: "image/00001", size: sound.length, content: sound },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("keeps only the entries of the requested volume", async () => {
		const first = Buffer.from("volume one payload");
		const second = Buffer.from("volume two payload");
		const built = buildArchive([
			{
				name: "image",
				entries: [
					{ volume: 1, payload: first },
					{ volume: 2, payload: second },
				],
			},
		]);
		await withCompanionFiles(
			"0002.dat",
			{
				"0001.dat": built.index,
				"0002.dat": requireVolume(built, 2),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: lazycrewDatFormat,
					mainPath,
					entries: [
						{ path: "image/00001", size: second.length, content: second },
					],
					metadata: { entryCount: 1 },
				});
			},
		);
	});

	it("wraps keyed pcm into a riff container", async () => {
		const format = Buffer.alloc(0x10, 0x11);
		const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
		const record = buildAudioRecord(0, pcm, format);
		await expectArchive({
			format: lazycrewDatFormat,
			sourcePath: "0001.dat",
			archive: singleFile([
				{ name: "sound", entries: [{ volume: 1, payload: record }] },
			]),
			entries: [
				{
					path: "sound/00000",
					size: record.length,
					content: expectedRiff(format, pcm),
				},
			],
		});
	});

	it("strips the audio signature marker", async () => {
		const payload = Buffer.from("raw audio bytes");
		const record = Buffer.concat([Buffer.from([1, 0, 0, 0]), payload]);
		await expectArchive({
			format: lazycrewDatFormat,
			sourcePath: "0001.dat",
			archive: singleFile([
				{ name: "sound", entries: [{ volume: 1, payload: record }] },
			]),
			entries: [{ path: "sound/00000", size: record.length, content: payload }],
		});
	});

	it("labels non image and sound directories by extension only", async () => {
		const payload = Buffer.from("misc payload");
		const archive = await lazycrewDatFormat.open(
			new BufferByteSource(
				singleFile([{ name: "script", entries: [{ volume: 1, payload }] }]),
			),
			"0001.dat",
		);
		expect(archive.entries[0]?.path).toBe("script/00000");
		expect(archive.entries[0]?.metadata?.type).toBeUndefined();
	});

	it("detects a data file without a numeric suffix", async () => {
		const payload = Buffer.from("data payload");
		await expectArchive({
			format: lazycrewDatFormat,
			sourcePath: "data",
			archive: singleFile([
				{ name: "image", entries: [{ volume: 1, payload }] },
			]),
			entries: [{ path: "image/00000", size: payload.length }],
		});
	});

	it("reads a numbered data companion", async () => {
		const payload = Buffer.from("second file payload");
		const built = buildArchive([
			{ name: "image", entries: [{ volume: 2, payload }] },
		]);
		await withCompanionFiles(
			"data2",
			{ data: built.index, data2: requireVolume(built, 2) },
			async (mainPath) => {
				await expectCompanionArchive({
					format: lazycrewDatFormat,
					mainPath,
					entries: [
						{ path: "image/00000", size: payload.length, content: payload },
					],
				});
			},
		);
	});

	it("rejects a file name outside the volume pattern", async () => {
		const file = singleFile([
			{
				name: "image",
				entries: [{ volume: 1, payload: Buffer.from("payload") }],
			},
		]);
		expect(
			await lazycrewDatFormat.detect(new BufferByteSource(file), "foo.dat"),
		).toBe(false);
		expect(
			await lazycrewDatFormat.detect(new BufferByteSource(file), "0000.dat"),
		).toBe(false);
	});

	it("rejects a volume without its index companion", async () => {
		const file = Buffer.alloc(0x40, 0);
		await withCompanionFiles(
			"0003.dat",
			{ "0003.dat": file },
			async (mainPath) => {
				expect(
					await lazycrewDatFormat.detect(new BufferByteSource(file), mainPath),
				).toBe(false);
			},
		);
	});

	it("rejects a directory record that leaves the index", async () => {
		const file = singleFile([
			{
				name: "image",
				entries: [{ volume: 1, payload: Buffer.from("payload") }],
			},
		]);
		file.writeInt32LE(0x1000, DIR_FIRST_OFFSET + 8);
		expect(
			await lazycrewDatFormat.detect(new BufferByteSource(file), "0001.dat"),
		).toBe(false);
	});
});
