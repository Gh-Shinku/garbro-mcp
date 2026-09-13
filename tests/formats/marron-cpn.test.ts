import { FileByteSource } from "@garbro-mcp/core";
import { cpnFormat } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, expect, it } from "vitest";

const KEY = 0x5a;

/** Wraps decoded text the way a `.cpn` file stores it: a leading key byte, then XORed CP932 text. */
function buildCpn(text: string, key = KEY): Buffer {
	const body = Buffer.from(text, "latin1");
	for (let position = 0; position < body.length; position += 1)
		body[position] = (body[position] ?? 0) ^ key;
	return Buffer.concat([Buffer.from([key]), body]);
}

interface CpnEntry {
	name: string;
	content: Buffer;
}

/** Builds the `.dat` payloads and the matching index text. */
function buildArchive(entries: readonly CpnEntry[]): {
	dat: Buffer;
	cpn: Buffer;
} {
	const dat = Buffer.concat(entries.map((entry) => entry.content));
	let offset = 0;
	let text = ".SAMPLE.DAT";
	for (const entry of entries) {
		text += `#${entry.name}$${offset}*${entry.content.length}+`;
		offset += entry.content.length;
	}
	return { dat, cpn: buildCpn(text) };
}

describe("Marron CPN resource archive", () => {
	it("reads a keyed companion index and decrypted payloads", async () => {
		const source = Buffer.from("first script body");
		const second = Buffer.from("second");
		const { dat, cpn } = buildArchive([
			{ name: "script/one.scr", content: source },
			{ name: "two.scr", content: second },
		]);
		// Payloads are XORed with the same key in this format.
		const payload = Buffer.from(dat);
		for (let position = 0; position < payload.length; position += 1)
			payload[position] = (payload[position] ?? 0) ^ KEY;
		await withCompanionFiles(
			"SAMPLE.DAT",
			{ "SAMPLE.DAT": payload, "SAMPLE.cpn": cpn },
			async (mainPath) => {
				await expectCompanionArchive({
					format: cpnFormat,
					mainPath,
					entries: [
						{
							path: "script/one.scr",
							size: source.length,
							content: source,
						},
						{ path: "two.scr", size: second.length, content: second },
					],
					metadata: { entryCount: 2, key: KEY },
				});
			},
		);
	});

	it("rejects an index that names another archive", async () => {
		const { dat, cpn } = buildArchive([
			{ name: "a", content: Buffer.from("x") },
		]);
		await withCompanionFiles(
			"OTHER.DAT",
			{ "OTHER.DAT": dat, "OTHER.cpn": cpn },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await cpnFormat.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});

	it("requires the companion index", async () => {
		await withCompanionFiles(
			"SAMPLE.DAT",
			{ "SAMPLE.DAT": Buffer.from("payload") },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await cpnFormat.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});
});
