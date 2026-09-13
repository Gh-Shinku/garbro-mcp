import { BufferByteSource } from "@garbro-mcp/core";
import {
	youkaiDatGrpFormat,
	youkaiDatSoundFormat,
	youkaiDatVoiceFormat,
} from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const NAME_SIZE = 0x100;

/** Writes a 0x100-byte CP932 name field. */
function writeName(target: Buffer, offset: number, name: string): void {
	target.write(name, offset, "latin1");
}

/** Builds a `GrpDatOpener` archive: a count, a zero word, then a 0x110-byte index and the payloads. */
function buildGrp(
	entries: readonly { name: string; content: Buffer }[],
): Buffer {
	const dataStart = 0x20 + entries.length * 0x110;
	const archive = Buffer.alloc(dataStart);
	archive.writeInt32LE(entries.length, 0);
	archive.writeInt32LE(0, 4);
	let cursor = dataStart;
	entries.forEach((entry, id) => {
		const record = 0x20 + id * 0x110;
		writeName(archive, record, entry.name);
		archive.writeUInt32LE(entry.content.length, record + 0x100);
		archive.writeUInt32LE(cursor, record + 0x104);
		cursor += entry.content.length;
	});
	const payloads = Buffer.concat(entries.map((entry) => entry.content));
	return Buffer.concat([archive, payloads]);
}

/** Builds an `ACMPRS03` payload: the magic, a 0x24-byte header and the LZSS stream. */
function buildPacked(content: Buffer): Buffer {
	const stream = literalLzssStream(content);
	const payload = Buffer.alloc(0x24 + stream.length);
	payload.write("ACMPRS03", 0, "latin1");
	payload.writeUInt32LE(stream.length, 0x14);
	stream.copy(payload, 0x24);
	return payload;
}

/** Builds a `SoundDatOpener` archive, whose records and payloads alternate behind the count. */
function buildSound(
	entries: readonly { name: string; content: Buffer }[],
): Buffer {
	const parts: Buffer[] = [Buffer.alloc(4)];
	parts[0]?.writeInt32LE(entries.length, 0);
	for (const entry of entries) {
		const record = Buffer.alloc(0x104);
		writeName(record, 0, entry.name);
		record.writeUInt32LE(entry.content.length, NAME_SIZE);
		parts.push(record, entry.content);
	}
	return Buffer.concat(parts);
}

/** Builds a `VoiceDatOpener` archive: a data offset, a count, a 0x108-byte index and the payloads. */
function buildVoice(
	entries: readonly { name: string; content: Buffer }[],
): Buffer {
	const dataStart = 8 + entries.length * 0x108;
	const index = Buffer.alloc(dataStart);
	index.writeUInt32LE(dataStart, 0);
	index.writeInt32LE(entries.length, 4);
	let cursor = dataStart;
	entries.forEach((entry, id) => {
		const record = 8 + id * 0x108;
		writeName(index, record, entry.name);
		index.writeUInt32LE(entry.content.length, record + NAME_SIZE);
		index.writeUInt32LE(cursor, record + NAME_SIZE + 4);
		cursor += entry.content.length;
	});
	const payloads = Buffer.concat(entries.map((entry) => entry.content));
	return Buffer.concat([index, payloads]);
}

describe("Youkai Tamanokoshi resource archive (DAT/YOUKAI/1)", () => {
	it("lists stored and packed group payloads", async () => {
		const stored = Buffer.from("group payload");
		const unpacked = Buffer.from("packed group payload contents");
		await expectArchive({
			format: youkaiDatGrpFormat,
			archive: buildGrp([
				{ name: "one.grp", content: stored },
				{ name: "two.grp", content: buildPacked(unpacked) },
			]),
			sourcePath: "sample.dat",
			entries: [
				{ path: "one.grp", size: stored.length, content: stored },
				{
					path: "two.grp",
					size: buildPacked(unpacked).length,
					content: unpacked,
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("does not treat a short payload as packed", async () => {
		const content = Buffer.from("ACMP");
		await expectArchive({
			format: youkaiDatGrpFormat,
			archive: buildGrp([{ name: "one.grp", content }]),
			sourcePath: "sample.dat",
			entries: [{ path: "one.grp", size: content.length, content }],
		});
	});

	it("rejects a non-zero word behind the count", async () => {
		const archive = buildGrp([
			{ name: "one.grp", content: Buffer.from("data") },
		]);
		archive.writeInt32LE(1, 4);
		await expectDeclined(youkaiDatGrpFormat, archive, "sample.dat");
	});

	it("rejects a payload that starts inside the index", async () => {
		const archive = buildGrp([
			{ name: "one.grp", content: Buffer.from("data") },
		]);
		archive.writeUInt32LE(0x20, 0x20 + 0x104);
		await expectDeclined(youkaiDatGrpFormat, archive, "sample.dat");
	});

	it("rejects an empty name", async () => {
		const archive = buildGrp([
			{ name: "one.grp", content: Buffer.from("data") },
		]);
		archive.fill(0, 0x20, 0x20 + NAME_SIZE);
		await expectDeclined(youkaiDatGrpFormat, archive, "sample.dat");
	});

	it("rejects a file whose extension is not dat", async () => {
		const archive = buildGrp([
			{ name: "one.grp", content: Buffer.from("data") },
		]);
		await expectDeclined(youkaiDatGrpFormat, archive, "sample.bin");
	});
});

describe("Youkai Tamanokoshi audio archive (DAT/YOUKAI/2)", () => {
	it("lists records whose payloads fill the file", async () => {
		const first = Buffer.from("first voice");
		const second = Buffer.from("second voice payload");
		await expectArchive({
			format: youkaiDatSoundFormat,
			archive: buildSound([
				{ name: "a.ogg", content: first },
				{ name: "b.ogg", content: second },
			]),
			sourcePath: "sample.dat",
			entries: [
				{ path: "a.ogg", size: first.length, content: first },
				{ path: "b.ogg", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects trailing bytes behind the last payload", async () => {
		const archive = Buffer.concat([
			buildSound([{ name: "a.ogg", content: Buffer.from("voice") }]),
			Buffer.from([0]),
		]);
		await expectDeclined(youkaiDatSoundFormat, archive, "sample.dat");
	});

	it("rejects a payload that reaches past the file", async () => {
		const archive = buildSound([
			{ name: "a.ogg", content: Buffer.from("voice") },
		]);
		archive.writeUInt32LE(0x1000, 4 + NAME_SIZE);
		await expectDeclined(youkaiDatSoundFormat, archive, "sample.dat");
	});
});

describe("Youkai Tamanokoshi audio archive (DAT/YOUKAI/3)", () => {
	it("lists payloads behind a data offset", async () => {
		const first = Buffer.from("first voice");
		const second = Buffer.from("second voice payload");
		await expectArchive({
			format: youkaiDatVoiceFormat,
			archive: buildVoice([
				{ name: "a.ogg", content: first },
				{ name: "b.ogg", content: second },
			]),
			sourcePath: "sample.dat",
			entries: [
				{ path: "a.ogg", size: first.length, content: first },
				{ path: "b.ogg", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects an index that reaches into the data area", async () => {
		const archive = buildVoice([
			{ name: "a.ogg", content: Buffer.from("voice") },
		]);
		archive.writeUInt32LE(8, 0);
		await expectDeclined(youkaiDatVoiceFormat, archive, "sample.dat");
	});

	it("rejects a payload that reaches past the file", async () => {
		const archive = buildVoice([
			{ name: "a.ogg", content: Buffer.from("voice") },
		]);
		archive.writeUInt32LE(0x1000, 8 + NAME_SIZE + 4);
		await expectDeclined(youkaiDatVoiceFormat, archive, "sample.dat");
	});
});

async function expectDeclined(
	format: typeof youkaiDatGrpFormat,
	archive: Buffer,
	sourcePath: string,
): Promise<void> {
	const source = new BufferByteSource(archive);
	expect(await format.detect(source, sourcePath)).toBe(false);
}
