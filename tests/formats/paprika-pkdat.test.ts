import { FileByteSource } from "@garbro-mcp/core";
import { pkDatFormat } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, expect, it } from "vitest";

const SLOT = 3; // PICPK

interface PkRecord {
	number: number;
	offset: number;
	size: number;
}

/** Builds the shared `SCNPK.DAT` companion with a record list in the PICPK slot. */
function buildScnpk(records: readonly PkRecord[]): Buffer {
	const indexPosition = 0x10;
	const companion = Buffer.alloc(indexPosition + records.length * 9);
	companion.writeUInt32LE(indexPosition, SLOT * 4);
	let position = indexPosition;
	for (const record of records) {
		companion.writeUInt8(record.number, position);
		companion.writeUInt32LE(record.offset, position + 1);
		companion.writeUInt32LE(record.size, position + 5);
		position += 9;
	}
	return companion;
}

describe("Paprika PK DAT resource archive", () => {
	it("selects the archive's records from the shared index", async () => {
		const first = Buffer.from("first slice!!");
		const second = Buffer.from("second slice");
		const payload = Buffer.concat([first, second]);
		await withCompanionFiles(
			"PICPK01.DAT",
			{
				"PICPK01.DAT": payload,
				"SCNPK.DAT": buildScnpk([
					{ number: 1, offset: 0, size: first.length },
					{ number: 0, offset: first.length, size: 0 },
					{ number: 1, offset: first.length, size: second.length },
				]),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: pkDatFormat,
					mainPath,
					entries: [
						{ path: "0000.PIC", size: first.length, content: first },
						{ path: "0002.PIC", size: second.length, content: second },
					],
					metadata: { entryCount: 2 },
				});
			},
		);
	});

	it("numbers entries by their position in the shared list", async () => {
		const payload = Buffer.from("only");
		await withCompanionFiles(
			"PICPK00.DAT",
			{
				"PICPK00.DAT": payload,
				"SCNPK.DAT": buildScnpk([
					{ number: 1, offset: 0, size: 4 },
					{ number: 0, offset: 0, size: 4 },
				]),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: pkDatFormat,
					mainPath,
					entries: [{ path: "0001.PIC", size: 4, content: payload }],
				});
			},
		);
	});

	it("rejects an archive name without a trailing digit", async () => {
		const payload = Buffer.from("payload");
		await withCompanionFiles(
			"PICPK.DAT",
			{
				"PICPK.DAT": payload,
				"SCNPK.DAT": buildScnpk([{ number: 0, offset: 0, size: 7 }]),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await pkDatFormat.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});

	it("requires the companion index", async () => {
		await withCompanionFiles(
			"PICPK01.DAT",
			{ "PICPK01.DAT": Buffer.from("payload") },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await pkDatFormat.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});
});
