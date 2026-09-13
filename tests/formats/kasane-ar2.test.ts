import { encodeCp932, FileByteSource } from "@garbro-mcp/core";
import { kasaneAr2Format } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, expect, it } from "vitest";

const KEY = 0x55;
const KEY_MASK = 0x55555555;

function xorName(name: string): Buffer {
	const bytes = encodeCp932(name);
	for (let position = 0; position < bytes.length; position += 1)
		bytes[position] = (bytes[position] ?? 0) ^ KEY;
	return bytes;
}

interface KasaneFixtureEntry {
	name: string;
	payload: Buffer;
}

/** Builds the companion `.idx` file: a record count and 0x18-byte records plus names. */
function buildIdx(entries: readonly KasaneFixtureEntry[]): Buffer {
	const records = entries.map((entry, id) => {
		const name = xorName(entry.name);
		// A record is 20 bytes of fields followed by the name, with no padding.
		const record = Buffer.alloc(20 + name.length);
		record.writeUInt32LE(entry.payload.length, 0);
		record.writeUInt32LE(entry.payload.length, 4);
		record.writeInt32LE(name.length, 12);
		record.writeUInt32LE(
			entries
				.slice(0, id)
				.reduce(
					(sum, previous) =>
						sum +
						0x10 +
						xorName(previous.name).length +
						previous.payload.length,
					0,
				),
			16,
		);
		name.copy(record, 20);
		return record;
	});
	const idx = Buffer.concat([Buffer.alloc(4), ...records]);
	idx.writeInt32LE(entries.length, 0);
	return idx;
}

/** Builds the payload side: a 0x10-byte header, the XORed name, and the XORed payload. */
function buildAr2(entries: readonly KasaneFixtureEntry[]): Buffer {
	const records = entries.map((entry) => {
		const name = xorName(entry.name);
		const header = Buffer.alloc(0x10);
		header.writeUInt32LE(name.length ^ KEY_MASK, 0x0c);
		const payload = Buffer.from(entry.payload);
		for (let position = 0; position < payload.length; position += 1)
			payload[position] = (payload[position] ?? 0) ^ KEY;
		return Buffer.concat([header, name, payload]);
	});
	return Buffer.concat(records);
}

const ENTRIES: readonly KasaneFixtureEntry[] = [
	{ name: "script/scene1.ar2", payload: Buffer.from("first script") },
	{ name: "scene2.ar2", payload: Buffer.from("second") },
];

describe("Kasane AR2 archive", () => {
	it("reads the companion .idx index and decrypts payloads", async () => {
		await withCompanionFiles(
			"game.ar2",
			{ "game.ar2": buildAr2(ENTRIES), "game.idx": buildIdx(ENTRIES) },
			async (mainPath) => {
				await expectCompanionArchive({
					format: kasaneAr2Format,
					mainPath,
					entries: ENTRIES.map((entry) => ({
						path: entry.name,
						size: entry.payload.length,
						content: entry.payload,
					})),
					metadata: { entryCount: 2 },
				});
			},
		);
	});

	it("requires the companion index", async () => {
		await withCompanionFiles(
			"game.ar2",
			{ "game.ar2": buildAr2(ENTRIES.slice(0, 1)) },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await kasaneAr2Format.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});
});
