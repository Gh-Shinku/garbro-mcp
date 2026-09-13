import { grooverPcgFormat } from "@garbro-mcp/formats";
import { FileByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";

async function isDetected(mainPath: string): Promise<boolean> {
	const source = await FileByteSource.open(mainPath);
	try {
		return await grooverPcgFormat.detect(source, mainPath);
	} finally {
		await source.close();
	}
}

const INDEX_HEADER_SIZE = 0x198;
const PART_NAME_SIZE = 0x20;
const FIRST_INDEX_OFFSET = 0x148;
const LAST_INDEX_OFFSET = 0x170;

interface Record {
	name: string;
	offset: number;
	size: number;
}

interface Part {
	name: string;
	first: number;
	last: number;
}

function buildGrooverIndex(
	count: number,
	entrySize: number,
	parts: readonly Part[],
	records: readonly Record[],
): Buffer {
	const index = Buffer.alloc(INDEX_HEADER_SIZE + entrySize * count);
	index.writeInt32LE(parts.length, 0);
	index.writeInt32LE(count, 4);
	for (const [part, description] of parts.entries()) {
		index.write(description.name, 8 + part * PART_NAME_SIZE, "latin1");
		index.writeInt32LE(description.first, FIRST_INDEX_OFFSET + part * 4);
		index.writeInt32LE(description.last, LAST_INDEX_OFFSET + part * 4);
	}
	const nameSize = entrySize >= 0x48 ? 0x40 : 0x20;
	for (const [position, record] of records.entries()) {
		const at = INDEX_HEADER_SIZE + entrySize * position;
		index.write(record.name, at, "latin1");
		index.writeUInt32LE(record.offset, at + nameSize);
		index.writeUInt32LE(record.size, at + nameSize + 4);
	}
	return index;
}

/** Packs the payloads into the archive and records where each of them landed. */
function packPayloads(payloads: readonly Buffer[]): {
	data: Buffer;
	offsets: number[];
} {
	const offsets: number[] = [];
	let total = 0;
	for (const payload of payloads) {
		offsets.push(total);
		total += payload.length;
	}
	return { data: Buffer.concat([...payloads]), offsets };
}

describe("Groover resource archive", () => {
	it("reads entries of a part from a companion index", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload bytes");
		const payloads = [first, second];
		const { data, offsets } = packPayloads(payloads);
		const index = buildGrooverIndex(
			2,
			0x30,
			[{ name: "GAME01.dat", first: 0, last: 2 }],
			[
				{
					name: "first.pcg",
					offset: offsets[0] ?? 0,
					size: payloads[0]?.length ?? 0,
				},
				{
					name: "second.pcg",
					offset: offsets[1] ?? 0,
					size: payloads[1]?.length ?? 0,
				},
			],
		);
		await withCompanionFiles(
			"GAME01.dat",
			{ "GAME01.dat": data, "GAME.pcg": index },
			async (mainPath) => {
				await expectCompanionArchive({
					format: grooverPcgFormat,
					mainPath,
					entries: [
						{ path: "first.pcg", size: first.length, content: first },
						{ path: "second.pcg", size: second.length, content: second },
					],
				});
			},
		);
	});

	it("reads forty byte names of long entries", async () => {
		const payload = Buffer.from("long name payload");
		const { data, offsets } = packPayloads([payload]);
		const name = "a very long graphic name that needs the long field.pcg";
		const index = buildGrooverIndex(
			1,
			0x48,
			[{ name: "GAME01.dat", first: 0, last: 1 }],
			[{ name, offset: offsets[0] ?? 0, size: payload.length }],
		);
		await withCompanionFiles(
			"GAME01.dat",
			{ "GAME01.dat": data, "GAME.pcg": index },
			async (mainPath) => {
				await expectCompanionArchive({
					format: grooverPcgFormat,
					mainPath,
					entries: [{ path: name, size: payload.length, content: payload }],
				});
			},
		);
	});

	it("takes the entry range of the matching part", async () => {
		const first = Buffer.from("part one");
		const second = Buffer.from("part two");
		const third = Buffer.from("part three");
		const payloads = [first, second, third];
		const { data, offsets } = packPayloads(payloads);
		const index = buildGrooverIndex(
			3,
			0x30,
			[
				{ name: "GAME01.dat", first: 0, last: 1 },
				{ name: "GAME02.dat", first: 1, last: 3 },
			],
			payloads.map((payload, position) => ({
				name: `part${position}.pcg`,
				offset: offsets[position] ?? 0,
				size: payload.length,
			})),
		);
		await withCompanionFiles(
			"GAME02.dat",
			{ "GAME02.dat": data, "GAME.pcg": index },
			async (mainPath) => {
				await expectCompanionArchive({
					format: grooverPcgFormat,
					mainPath,
					entries: [
						{ path: "part1.pcg", size: second.length, content: second },
						{ path: "part2.pcg", size: third.length, content: third },
					],
				});
			},
		);
	});

	it("falls back to the spf index name", async () => {
		const payload = Buffer.from("spf payload");
		const { data, offsets } = packPayloads([payload]);
		const index = buildGrooverIndex(
			1,
			0x30,
			[{ name: "GAME01.dat", first: 0, last: 1 }],
			[{ name: "only.pcg", offset: offsets[0] ?? 0, size: payload.length }],
		);
		await withCompanionFiles(
			"GAME01.dat",
			{ "GAME01.dat": data, "GAME.spf": index },
			async (mainPath) => {
				await expectCompanionArchive({
					format: grooverPcgFormat,
					mainPath,
					entries: [
						{ path: "only.pcg", size: payload.length, content: payload },
					],
				});
			},
		);
	});

	it("rejects an archive without a companion index", async () => {
		const payload = Buffer.from("payload");
		await withCompanionFiles(
			"GAME01.dat",
			{ "GAME01.dat": payload },
			async (mainPath) => {
				expect(await isDetected(mainPath)).toBe(false);
			},
		);
	});

	it("rejects an archive name without the numbered suffix", async () => {
		const payload = Buffer.from("payload");
		const index = buildGrooverIndex(
			1,
			0x30,
			[{ name: "GAME.dat", first: 0, last: 1 }],
			[{ name: "only.pcg", offset: 0, size: payload.length }],
		);
		await withCompanionFiles(
			"GAME.dat",
			{ "GAME.dat": payload, "GAME.pcg": index },
			async (mainPath) => {
				expect(await isDetected(mainPath)).toBe(false);
			},
		);
	});

	it("rejects an index range that leaves the entry table", async () => {
		const payload = Buffer.from("payload");
		const { data, offsets } = packPayloads([payload]);
		const index = buildGrooverIndex(
			1,
			0x30,
			[{ name: "GAME01.dat", first: 0, last: 2 }],
			[{ name: "only.pcg", offset: offsets[0] ?? 0, size: payload.length }],
		);
		await withCompanionFiles(
			"GAME01.dat",
			{ "GAME01.dat": data, "GAME.pcg": index },
			async (mainPath) => {
				expect(await isDetected(mainPath)).toBe(false);
			},
		);
	});

	it("rejects an entry that leaves the archive", async () => {
		const payload = Buffer.from("payload");
		const { data } = packPayloads([payload]);
		const index = buildGrooverIndex(
			1,
			0x30,
			[{ name: "GAME01.dat", first: 0, last: 1 }],
			[{ name: "only.pcg", offset: 0x1000, size: payload.length }],
		);
		await withCompanionFiles(
			"GAME01.dat",
			{ "GAME01.dat": data, "GAME.pcg": index },
			async (mainPath) => {
				expect(await isDetected(mainPath)).toBe(false);
			},
		);
	});

	it("reports the entry count", async () => {
		const payloads = [Buffer.from("abc"), Buffer.from("de")];
		const { data, offsets } = packPayloads(payloads);
		const index = buildGrooverIndex(
			2,
			0x30,
			[{ name: "GAME01.dat", first: 0, last: 2 }],
			payloads.map((payload, position) => ({
				name: `file${position}.pcg`,
				offset: offsets[position] ?? 0,
				size: payload.length,
			})),
		);
		await withCompanionFiles(
			"GAME01.dat",
			{ "GAME01.dat": data, "GAME.pcg": index },
			async (mainPath) => {
				await expectCompanionArchive({
					format: grooverPcgFormat,
					mainPath,
					entries: [
						{ path: "file0.pcg", size: 3 },
						{ path: "file1.pcg", size: 2 },
					],
					metadata: { entryCount: 2 },
				});
			},
		);
	});
});
