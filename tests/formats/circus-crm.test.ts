import { encodeCp932 } from "@garbro-mcp/core";
import { crmFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x20;

interface CrmEntry {
	name: string;
	content: Buffer;
}

function buildCrm(
	entries: readonly CrmEntry[],
	order?: readonly number[],
): Buffer {
	const count = entries.length;
	const dataOffset = INDEX_OFFSET + count * RECORD_SIZE;
	const archive = Buffer.concat([
		Buffer.alloc(dataOffset),
		...entries.map((entry) => entry.content),
	]);
	archive.write("CRXB", 0, "ascii");
	archive.writeInt32LE(count, 8);
	const offsets: number[] = [];
	let offset = dataOffset;
	for (const entry of entries) {
		offsets.push(offset);
		offset += entry.content.length;
	}
	const order_ = order ?? offsets.map((_, id) => id);
	for (const [record, id] of order_.entries()) {
		const entry = entries[id];
		if (!entry) continue;
		archive.writeUInt32LE(
			offsets[id] ?? 0,
			INDEX_OFFSET + record * RECORD_SIZE,
		);
		encodeCp932(entry.name).copy(
			archive,
			INDEX_OFFSET + record * RECORD_SIZE + 8,
		);
	}
	return archive;
}

describe("Circus CRM image archive", () => {
	it("derives sizes from sorted offsets", async () => {
		const first = Buffer.from("first image!");
		const second = Buffer.from("second");
		await expectArchive({
			format: crmFormat,
			archive: buildCrm([
				{ name: "a.bmp", content: first },
				{ name: "b.bmp", content: second },
			]),
			sourcePath: "sample.crm",
			entries: [
				{ path: "a.bmp", size: first.length, content: first },
				{ path: "b.bmp", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("sorts an out-of-order index", async () => {
		const first = Buffer.from("first");
		const second = Buffer.from("second!!");
		await expectArchive({
			format: crmFormat,
			archive: buildCrm(
				[
					{ name: "a.bmp", content: first },
					{ name: "b.bmp", content: second },
				],
				[1, 0],
			),
			sourcePath: "sample.crm",
			entries: [
				{ path: "b.bmp", size: second.length, content: second },
				{ path: "a.bmp", size: first.length, content: first },
			],
		});
	});

	it("gives duplicate offsets the size of the last record", async () => {
		const first = Buffer.from("first");
		const second = Buffer.from("second");
		const archive = buildCrm([
			{ name: "a.bmp", content: first },
			{ name: "b.bmp", content: second },
		]);
		// Point the second record at the first payload as well: only the last record of a shared
		// offset receives a derived size, and the merged range runs to the end of the file.
		archive.writeUInt32LE(
			archive.readUInt32LE(INDEX_OFFSET),
			INDEX_OFFSET + RECORD_SIZE,
		);
		await expectArchive({
			format: crmFormat,
			archive,
			sourcePath: "sample.crm",
			entries: [
				{ path: "a.bmp", size: 0, content: Buffer.alloc(0) },
				{
					path: "b.bmp",
					size: first.length + second.length,
					content: Buffer.concat([first, second]),
				},
			],
		});
	});

	it("rejects a missing signature", async () => {
		const archive = buildCrm([{ name: "a.bmp", content: Buffer.from("a") }]);
		archive.write("CRXA", 0, "ascii");
		await expectArchive({
			format: crmFormat,
			archive,
			sourcePath: "sample.crm",
			detected: false,
			entries: [],
		});
	});
});
