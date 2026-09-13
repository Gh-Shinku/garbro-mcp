import { encodeCp932, FileByteSource } from "@garbro-mcp/core";
import {
	cyberworksCsystemDat2Format,
	cyberworksCsystemDatFormat,
	cyberworksDatFormat,
} from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { literalLzssStream } from "../helpers/lzss.js";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";

/** Encodes a decimal field of `length` digits, least significant digit last. */
function encodeDecimal(value: number, length: number): Buffer {
	const field = Buffer.alloc(length);
	let remaining = value;
	for (let i = length - 1; i >= 0; i -= 1) {
		field[i] = ((remaining % 10) ^ 0x7f) & 0xff;
		remaining = Math.floor(remaining / 10);
	}
	return field;
}

/** Wraps a table body the way a table file is stored: two decimal fields and a packed body. */
function packTable(body: Buffer, numLength: number): Buffer {
	const packed = literalLzssStream(body);
	return Buffer.concat([
		encodeDecimal(body.length, numLength),
		encodeDecimal(packed.length, numLength),
		packed,
	]);
}

interface ModernRecord {
	id: number;
	unpacked: number;
	stored: number;
	offset: number;
	/** Two type bytes, or a single one for the old record layout. */
	type: string;
	/** Sub-archive index, which widens the record to the larger layout. */
	arcIndex?: number;
}

/** Builds a modern table body: size word, entry fields and type bytes. */
function modernBody(records: readonly ModernRecord[]): Buffer {
	const parts = records.map((record) => {
		const wide = record.arcIndex !== undefined;
		const typeBytes = Buffer.from(record.type, "latin1");
		const recordSize = 16 + typeBytes.length + (wide ? 5 : 0);
		const buffer = Buffer.alloc(4 + recordSize);
		buffer.writeInt32LE(recordSize, 0);
		buffer.writeUInt32LE(record.id, 4);
		buffer.writeUInt32LE(record.unpacked, 8);
		buffer.writeUInt32LE(record.stored, 12);
		buffer.writeUInt32LE(record.offset, 16);
		typeBytes.copy(buffer, 20);
		if (wide)
			buffer.writeUInt8(record.arcIndex ?? 0, 20 + typeBytes.length + 4);
		return buffer;
	});
	return Buffer.concat(parts);
}

/** Builds a meta archive holding a CP932 title. */
function metaArchive(title: string): Buffer {
	const encoded = encodeCp932(title);
	const body = Buffer.alloc(4 + encoded.length);
	body.writeInt32LE(encoded.length, 0);
	encoded.copy(body, 4);
	return packTable(body, 8);
}

const IMAGE = Buffer.from("modern image payload");
const SOUND = Buffer.from("modern sound payload");

describe("Cyberworks resource archive", () => {
	it("lists entries through a named table", async () => {
		const packed = literalLzssStream(SOUND);
		const body = modernBody([
			{
				id: 1,
				unpacked: IMAGE.length,
				stored: IMAGE.length,
				offset: 0,
				type: "b0",
			},
			{
				id: 2,
				unpacked: SOUND.length,
				stored: packed.length,
				offset: IMAGE.length,
				type: "j0",
			},
		]);
		const archive = Buffer.concat([IMAGE, packed]);
		await withCompanionFiles(
			"sample6.dat",
			{ "sample3.dat": packTable(body, 8), "sample6.dat": archive },
			async (mainPath) => {
				await expectCompanionArchive({
					format: cyberworksDatFormat,
					mainPath,
					entries: [
						{ path: "000001.b0", size: IMAGE.length, content: IMAGE },
						{ path: "000002.j0", size: SOUND.length, content: SOUND },
					],
					metadata: { entryCount: 2, hasImages: true },
				});
			},
		);
	});

	it("opens a table named by a meta archive and honours its bare image extension", async () => {
		const payload = Buffer.from("bare image payload");
		const body = modernBody([
			{
				id: 1,
				unpacked: payload.length,
				stored: payload.length,
				offset: 0,
				type: "b",
			},
		]);
		await withCompanionFiles(
			"Arc05.dat",
			{
				"Arc06.dat": metaArchive("Some Title"),
				"Arc04.dat": packTable(body, 8),
				"Arc05.dat": payload,
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: cyberworksDatFormat,
					mainPath,
					entries: [
						{ path: "000001.b", size: payload.length, content: payload },
					],
					metadata: { entryCount: 1, hasImages: true },
				});
			},
		);
	});

	it("keeps a bare image extension when the meta archive names the exempt game", async () => {
		const payload = Buffer.from("bare image payload");
		const body = modernBody([
			{
				id: 1,
				unpacked: payload.length,
				stored: payload.length,
				offset: 0,
				type: "b",
			},
		]);
		await withCompanionFiles(
			"Arc05.dat",
			{
				"Arc06.dat": metaArchive("ドキドキ母娘レッスン ～教えて♪Ｈなお勉強～"),
				"Arc04.dat": packTable(body, 8),
				"Arc05.dat": payload,
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: cyberworksDatFormat,
					mainPath,
					entries: [
						{ path: "000001.b", size: payload.length, content: payload },
					],
					metadata: { entryCount: 1, hasImages: false },
				});
			},
		);
	});

	it("drops records of other sub-archives", async () => {
		const payload = Buffer.from("first archive payload");
		const body = modernBody([
			{
				id: 1,
				unpacked: payload.length,
				stored: payload.length,
				offset: 0,
				type: "k0",
				arcIndex: 0,
			},
			{
				id: 2,
				unpacked: payload.length,
				stored: payload.length,
				offset: 0,
				type: "k0",
				arcIndex: 3,
			},
		]);
		await withCompanionFiles(
			"sample6.dat",
			{ "sample3.dat": packTable(body, 8), "sample6.dat": payload },
			async (mainPath) => {
				await expectCompanionArchive({
					format: cyberworksDatFormat,
					mainPath,
					entries: [
						{ path: "000001.k0", size: payload.length, content: payload },
					],
					metadata: { entryCount: 1, hasImages: false },
				});
			},
		);
	});

	it("declines an archive without a table and a table that does not parse", async () => {
		const payload = Buffer.from("payload");
		await withCompanionFiles(
			"sample6.dat",
			{ "sample6.dat": payload },
			async (mainPath) => {
				await expectDeclined(cyberworksDatFormat, mainPath);
			},
		);
		await withCompanionFiles(
			"sample6.dat",
			{ "sample3.dat": Buffer.from("not a table"), "sample6.dat": payload },
			async (mainPath) => {
				await expectDeclined(cyberworksDatFormat, mainPath);
			},
		);
	});

	it("declines an archive whose only record leaves the file", async () => {
		const payload = Buffer.from("payload");
		const body = modernBody([
			{
				id: 1,
				unpacked: payload.length,
				stored: payload.length,
				offset: 0x10000,
				type: "k0",
			},
		]);
		await withCompanionFiles(
			"sample6.dat",
			{ "sample3.dat": packTable(body, 8), "sample6.dat": payload },
			async (mainPath) => {
				await expectDeclined(cyberworksDatFormat, mainPath);
			},
		);
	});
});

describe("TinkerBell resource archive (comma separated table)", () => {
	it("lists entries of a CSV table", async () => {
		const image = Buffer.from("csv image payload");
		const sound = Buffer.from("csv sound payload");
		const packed = literalLzssStream(sound);
		const text = Buffer.from("text");
		const csv = [
			`one,${image.length},${image.length},0,b`,
			`two,${sound.length},${packed.length},${image.length},j`,
			`three,${text.length},${text.length},${image.length + packed.length},t`,
			"",
		].join("\n");
		await withCompanionFiles(
			"Arc03.dat",
			{
				"Arc01.dat": packTable(Buffer.from(csv, "latin1"), 4),
				"Arc03.dat": Buffer.concat([image, packed, text]),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: cyberworksCsystemDatFormat,
					mainPath,
					entries: [
						{ path: "one.b", size: image.length, content: image },
						{ path: "two.j", size: sound.length, content: sound },
						{ path: "three.t", size: text.length, content: text },
					],
					metadata: { entryCount: 3, hasImages: true },
				});
			},
		);
	});

	it("declines a table with a malformed line and one with an out-of-range entry", async () => {
		const payload = Buffer.from("payload");
		const malformed = "one.bmp,4,4,0\n";
		await withCompanionFiles(
			"Arc03.dat",
			{
				"Arc01.dat": packTable(Buffer.from(malformed, "latin1"), 4),
				"Arc03.dat": payload,
			},
			async (mainPath) => {
				await expectDeclined(cyberworksCsystemDatFormat, mainPath);
			},
		);
		const outOfRange = "one.bmp,4,4,4096,b\n";
		await withCompanionFiles(
			"Arc03.dat",
			{
				"Arc01.dat": packTable(Buffer.from(outOfRange, "latin1"), 4),
				"Arc03.dat": payload,
			},
			async (mainPath) => {
				await expectDeclined(cyberworksCsystemDatFormat, mainPath);
			},
		);
	});

	it("declines a name that no old archive pattern matches", async () => {
		const payload = Buffer.from("payload");
		await withCompanionFiles(
			"sample.dat",
			{ "sample.dat": payload },
			async (mainPath) => {
				await expectDeclined(cyberworksCsystemDatFormat, mainPath);
			},
		);
	});
});

describe("TinkerBell resource archive (numeric table)", () => {
	it("lists entries of a numeric table", async () => {
		const image = Buffer.from("numeric image payload");
		const body = modernBody([
			{
				id: 1,
				unpacked: image.length,
				stored: image.length,
				offset: 0,
				type: "b",
			},
			{
				id: 2,
				unpacked: image.length,
				stored: image.length,
				offset: 0,
				type: "x",
			},
		]);
		await withCompanionFiles(
			"Arc03.dat",
			{ "Arc01.dat": packTable(body, 4), "Arc03.dat": image },
			async (mainPath) => {
				await expectCompanionArchive({
					format: cyberworksCsystemDat2Format,
					mainPath,
					entries: [
						{ path: "000001.b", size: image.length, content: image },
						{ path: "000002.x", size: image.length, content: image },
					],
					metadata: { entryCount: 2, hasImages: true },
				});
			},
		);
	});

	it("declines a record whose size disagrees with the old layout", async () => {
		const payload = Buffer.from("payload");
		const body = modernBody([
			{
				id: 1,
				unpacked: payload.length,
				stored: payload.length,
				offset: 0,
				type: "b",
				arcIndex: 0,
			},
		]);
		await withCompanionFiles(
			"Arc03.dat",
			{ "Arc01.dat": packTable(body, 4), "Arc03.dat": payload },
			async (mainPath) => {
				await expectDeclined(cyberworksCsystemDat2Format, mainPath);
			},
		);
	});
});

async function expectDeclined(
	format: typeof cyberworksDatFormat | typeof cyberworksCsystemDatFormat,
	mainPath: string,
): Promise<void> {
	const source = await FileByteSource.open(mainPath);
	try {
		expect(await format.detect(source, mainPath)).toBe(false);
	} finally {
		await source.close();
	}
}
