import { FileByteSource } from "@garbro-mcp/core";
import { exhGRPFormat } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, expect, it } from "vitest";

const BLOCK_HEADER_SIZE = 0x10;
const RECORD_SIZE = 8;

interface Block {
	/** The reference number its header starts with, or the marker followed by the number. */
	reference: number;
	useMarker?: boolean;
	startIndex: number;
	records: readonly { offset: number; size: number }[];
}

/** Builds an `AiFS` table of contents: a resource count, then one block per archive. */
function buildTable(blocks: readonly Block[]): Buffer {
	const size = blocks.reduce(
		(sum, block) =>
			sum +
			BLOCK_HEADER_SIZE +
			(block.useMarker === true ? 4 : 0) +
			block.records.length * RECORD_SIZE,
		0x10,
	);
	const table = Buffer.alloc(size);
	table.write("AiFS", 0, "ascii");
	table.writeInt32LE(blocks.length, 0x0c);
	let position = 0x10;
	for (const block of blocks) {
		// A marker word shifts the whole header by four bytes, which is why the reference advances past it.
		const shift = block.useMarker === true ? 4 : 0;
		if (block.useMarker === true) table.writeInt32LE(0x01000000, position);
		table.writeInt32LE(block.reference, position + shift);
		table.writeInt32LE(block.startIndex, position + shift + 4);
		table.writeInt32LE(block.records.length, position + shift + 0x0c);
		position += BLOCK_HEADER_SIZE + shift;
		for (const record of block.records) {
			table.writeUInt32LE(record.offset, position);
			table.writeUInt32LE(record.size, position + 4);
			position += RECORD_SIZE;
		}
	}
	return table;
}

async function runCase(
	archive: Buffer,
	table: Buffer | undefined,
	check: (mainPath: string) => Promise<void>,
): Promise<void> {
	await withCompanionFiles(
		"res0001.grp",
		table === undefined
			? { "res0001.grp": archive }
			: { "res0001.grp": archive, "res0000.grp": table },
		check,
	);
}

describe("ExHIBIT engine audio resource archive", () => {
	it("reads its entry list from the sibling table of contents", async () => {
		const first = Buffer.from("first audio");
		const second = Buffer.from("second audio");
		const archive = Buffer.concat([first, second]);
		const table = buildTable([
			{
				reference: 1,
				startIndex: 3,
				records: [
					{ offset: 0, size: first.length },
					{ offset: first.length, size: second.length },
				],
			},
		]);
		await runCase(archive, table, async (mainPath) => {
			await expectCompanionArchive({
				format: exhGRPFormat,
				mainPath,
				entries: [
					{ path: "00003.ogg", size: first.length, content: first },
					{ path: "00004.ogg", size: second.length, content: second },
				],
			});
		});
	});

	it("accepts a block behind the marker word", async () => {
		const content = Buffer.from("marked audio");
		const table = buildTable([
			{
				reference: 1,
				useMarker: true,
				startIndex: 0,
				records: [{ offset: 0, size: content.length }],
			},
		]);
		await runCase(content, table, async (mainPath) => {
			await expectCompanionArchive({
				format: exhGRPFormat,
				mainPath,
				entries: [{ path: "00000.ogg", size: content.length, content }],
			});
		});
	});

	it("skips blocks that belong to another archive", async () => {
		const content = Buffer.from("later audio");
		const table = buildTable([
			{
				reference: 42,
				startIndex: 0,
				records: [{ offset: 0, size: 0x100 }],
			},
			{
				reference: 1,
				startIndex: 7,
				records: [{ offset: 0, size: content.length }],
			},
		]);
		await runCase(content, table, async (mainPath) => {
			await expectCompanionArchive({
				format: exhGRPFormat,
				mainPath,
				entries: [{ path: "00007.ogg", size: content.length, content }],
			});
		});
	});

	it("skips a record with no size", async () => {
		const content = Buffer.from("only audio");
		const table = buildTable([
			{
				reference: 1,
				startIndex: 0,
				records: [
					{ offset: 0, size: 0 },
					{ offset: 0, size: content.length },
				],
			},
		]);
		await runCase(content, table, async (mainPath) => {
			await expectCompanionArchive({
				format: exhGRPFormat,
				mainPath,
				entries: [{ path: "00001.ogg", size: content.length, content }],
			});
		});
	});

	it("rejects an archive without a table of contents", async () => {
		const content = Buffer.from("body");
		await runCase(content, undefined, async (mainPath) => {
			const source = await FileByteSource.open(mainPath);
			expect(await exhGRPFormat.detect(source, mainPath)).toBe(false);
			await source.close();
		});
	});

	it("requires the resXXXX.grp name pattern", async () => {
		const content = Buffer.from("body");
		await withCompanionFiles(
			"sample.grp",
			{ "sample.grp": content, "sample0000.grp": buildTable([]) },
			async (mainPath) => {
				const { FileByteSource } = await import("@garbro-mcp/core");
				const source = await FileByteSource.open(mainPath);
				expect(await exhGRPFormat.detect(source, mainPath)).toBe(false);
				await source.close();
			},
		);
	});
});
