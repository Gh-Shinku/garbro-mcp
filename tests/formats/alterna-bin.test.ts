import { BufferByteSource } from "@garbro-mcp/core";
import { alternaBinFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { literalLzssStream } from "../helpers/lzss.js";

const MAIN_NAME = "archive.bin";
const LIST_NAME = "archive.lst";
const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x30;
const NAME_SIZE = 0x20;
const NAME_KEY = 0x80;
const LZSS_HEADER_SIZE = 8;

interface Entry {
	name: string;
	/** Extracted content when the payload is an LZSS stream. */
	content?: Buffer;
	/** Stored payload, used verbatim when no content is given. */
	stored?: Buffer;
	packed?: boolean;
}

/** Builds the archive and its sibling list, returning both. */
function buildAlterna(entries: readonly Entry[]): {
	archive: Buffer;
	list: Buffer;
} {
	const payloads = entries.map((entry) => {
		if (entry.content && entry.packed)
			return Buffer.concat([
				Buffer.from("LZSS", "ascii"),
				Buffer.alloc(LZSS_HEADER_SIZE - 4),
				literalLzssStream(entry.content),
			]);
		return entry.stored ?? entry.content ?? Buffer.alloc(0);
	});
	const archive = Buffer.concat(payloads);
	const list = Buffer.alloc(INDEX_OFFSET + entries.length * RECORD_SIZE);
	list.write("ARC1.00", 0, "ascii");
	list.writeInt32LE(entries.length, 8);
	let offset = 0;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		const payload = payloads[id] ?? Buffer.alloc(0);
		list.writeInt32LE(entry.packed ? 1 : 0, record);
		list.writeUInt32LE(entry.content?.length ?? payload.length, record + 4);
		list.writeUInt32LE(payload.length, record + 8);
		list.writeUInt32LE(offset, record + 0xc);
		const nameBytes = Buffer.from(entry.name, "latin1");
		for (let position = 0; position < nameBytes.length; position += 1)
			list[record + 0x10 + position] = (nameBytes[position] ?? 0) ^ NAME_KEY;
		offset += payload.length;
	}
	return { archive, list };
}

describe("Alterna resource archive", () => {
	it("reads stored entries through the sibling list", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		const built = buildAlterna([
			{ name: "first.dat", stored: first },
			{ name: "second.dat", stored: second },
		]);
		await withCompanionFiles(
			MAIN_NAME,
			{ [MAIN_NAME]: built.archive, [LIST_NAME]: built.list },
			async (mainPath) => {
				await expectCompanionArchive({
					format: alternaBinFormat,
					mainPath,
					metadata: { entryCount: 2 },
					entries: [
						{
							path: "first.dat",
							size: first.length,
							content: first,
						},
						{
							path: "second.dat",
							size: second.length,
							content: second,
						},
					],
				});
			},
		);
	});

	it("decodes packed entries behind the lzss marker", async () => {
		const content = Buffer.from("packed payload");
		const built = buildAlterna([{ name: "packed.dat", content, packed: true }]);
		await withCompanionFiles(
			MAIN_NAME,
			{ [MAIN_NAME]: built.archive, [LIST_NAME]: built.list },
			async (mainPath) => {
				await expectCompanionArchive({
					format: alternaBinFormat,
					mainPath,
					entries: [{ path: "packed.dat", size: content.length, content }],
				});
			},
		);
	});

	it("serves a packed entry without the lzss marker verbatim", async () => {
		const payload = Buffer.from("plain payload");
		const built = buildAlterna([
			{ name: "plain.dat", stored: payload, packed: true },
		]);
		await withCompanionFiles(
			MAIN_NAME,
			{ [MAIN_NAME]: built.archive, [LIST_NAME]: built.list },
			async (mainPath) => {
				await expectCompanionArchive({
					format: alternaBinFormat,
					mainPath,
					entries: [
						{
							path: "plain.dat",
							size: payload.length,
							content: payload,
						},
					],
				});
			},
		);
	});

	it("requires the sibling list", async () => {
		const built = buildAlterna([
			{ name: "first.dat", stored: Buffer.from("payload") },
		]);
		await withCompanionFiles(
			MAIN_NAME,
			{ [MAIN_NAME]: built.archive },
			async (mainPath) => {
				const source = new BufferByteSource(built.archive);
				expect(await alternaBinFormat.detect(source, mainPath)).toBe(false);
			},
		);
	});

	it("refuses a main file that is itself a list", async () => {
		const built = buildAlterna([
			{ name: "first.dat", stored: Buffer.from("payload") },
		]);
		await withCompanionFiles(
			LIST_NAME,
			{ [LIST_NAME]: built.list },
			async (mainPath) => {
				const source = new BufferByteSource(built.list);
				expect(await alternaBinFormat.detect(source, mainPath)).toBe(false);
			},
		);
	});

	it("rejects a list with a foreign signature", async () => {
		const built = buildAlterna([
			{ name: "first.dat", stored: Buffer.from("payload") },
		]);
		built.list.write("XXXX.00", 0, "ascii");
		await withCompanionFiles(
			MAIN_NAME,
			{ [MAIN_NAME]: built.archive, [LIST_NAME]: built.list },
			async (mainPath) => {
				const source = new BufferByteSource(built.archive);
				expect(await alternaBinFormat.detect(source, mainPath)).toBe(false);
			},
		);
	});
});
