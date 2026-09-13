import { encodeCp932, FileByteSource } from "@garbro-mcp/core";
import { dskFormat } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, expect, it } from "vitest";

const CLUSTER_SIZE = 4;
const HEADER_SIZE = 0x20;
const SLOT_SIZE = 0x10;

interface DskEntry {
	name: string;
	content: Buffer;
}

/**
 * Builds the companion `.pft` index: a header, a cluster size, a record count, and records that hold
 * a NUL-terminated name plus a cluster index and size. Empty names carry no tail, and every non-empty
 * record claims the next 0x10-byte slot.
 */
function buildPft(entries: readonly (DskEntry | undefined)[]): Buffer {
	const header = Buffer.alloc(HEADER_SIZE);
	header.writeUInt16LE(HEADER_SIZE, 0);
	header.writeUInt16LE(CLUSTER_SIZE, 2);
	header.writeInt32LE(entries.length, 4);
	let slot = 0;
	const records = entries.map((entry) => {
		if (!entry) return Buffer.from([0]);
		const name = encodeCp932(entry.name);
		const tail = Buffer.alloc(8);
		tail.writeUInt32LE((slot * SLOT_SIZE) / CLUSTER_SIZE, 0);
		tail.writeUInt32LE(entry.content.length, 4);
		slot += 1;
		return Buffer.concat([name, Buffer.from([0]), tail]);
	});
	return Buffer.concat([header, ...records]);
}

/** Builds the payload file with one 0x10-byte slot per entry, in record order. */
function buildPayload(entries: readonly DskEntry[]): Buffer {
	const payload = Buffer.alloc(entries.length * SLOT_SIZE);
	for (const [slot, entry] of entries.entries())
		entry.content.copy(payload, slot * SLOT_SIZE);
	return payload;
}

describe("AbogadoPowers DSK resource archive", () => {
	it("reads the companion .pft index and rewrites extensions", async () => {
		const entries = [
			{ name: "cg01", content: Buffer.from("image one") },
			{ name: "cg02", content: Buffer.from("image two!") },
		];
		await withCompanionFiles(
			"BACK.dsk",
			{
				"BACK.dsk": buildPayload(entries),
				"BACK.pft": buildPft(entries),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: dskFormat,
					mainPath,
					entries: entries.map((entry) => ({
						path: `${entry.name}.KG`,
						size: entry.content.length,
						content: entry.content,
					})),
					metadata: { entryCount: 2 },
				});
			},
		);
	});

	it("skips records with an empty name", async () => {
		const target = { name: "b", content: Buffer.from("payload") };
		await withCompanionFiles(
			"SCENE.dsk",
			{
				"SCENE.dsk": buildPayload([target]),
				"SCENE.pft": buildPft([undefined, target]),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: dskFormat,
					mainPath,
					entries: [
						{
							path: "b.SCF",
							size: target.content.length,
							content: target.content,
						},
					],
				});
			},
		);
	});

	it("requires the companion index", async () => {
		await withCompanionFiles(
			"BACK.dsk",
			{ "BACK.dsk": Buffer.from("payload") },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await dskFormat.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});
});
