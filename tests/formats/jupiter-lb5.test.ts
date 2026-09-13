import { encodeCp932, FileByteSource } from "@garbro-mcp/core";
import { lb5Format } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, expect, it } from "vitest";

const RECORD_SIZE = 0x18;
const NAME_OFFSET = 9;

interface Lb5Entry {
	name: string;
	content: Buffer;
}

function buildIdx(entries: readonly Lb5Entry[], dataOffset = 0): Buffer {
	const idx = Buffer.alloc(4 + entries.length * RECORD_SIZE);
	idx.writeInt32LE(entries.length, 0);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = 4 + id * RECORD_SIZE;
		idx.writeUInt32LE(offset, record);
		idx.writeUInt32LE(entry.content.length, record + 4);
		encodeCp932(entry.name).copy(idx, record + NAME_OFFSET);
		offset += entry.content.length;
	}
	return idx;
}

describe("Jupiter LB5 resource archive", () => {
	it("reads the companion .idx index", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second");
		await withCompanionFiles(
			"data.lb5",
			{
				"data.lb5": Buffer.concat([first, second]),
				"data.idx": buildIdx([
					{ name: "graphic/one", content: first },
					{ name: "two", content: second },
				]),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: lb5Format,
					mainPath,
					entries: [
						{ path: "graphic/one", size: first.length, content: first },
						{ path: "two", size: second.length, content: second },
					],
					metadata: { entryCount: 2 },
				});
			},
		);
	});

	it("requires the lb5 extension", async () => {
		await withCompanionFiles(
			"data.bin",
			{
				"data.bin": Buffer.from("payload"),
				"data.idx": buildIdx([{ name: "a", content: Buffer.from("payload") }]),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await lb5Format.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});

	it("requires the companion index", async () => {
		await withCompanionFiles(
			"data.lb5",
			{ "data.lb5": Buffer.from("payload") },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await lb5Format.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});
});
