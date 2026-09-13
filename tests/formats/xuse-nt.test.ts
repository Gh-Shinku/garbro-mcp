import { BufferByteSource } from "@garbro-mcp/core";
import { xuseBgFormat, xuseHFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const BG_SMALL_SIZE = 0x4b400;
const BG_LARGE_SIZE = 0x96400;
const H_SMALL_SIZE = 0x25480;
const H_LARGE_SIZE = 0x2a700;

/** Fills a buffer with a repeating pattern so record boundaries are visible in the content check. */
function pattern(size: number, seed: number): Buffer {
	const data = Buffer.alloc(size);
	for (let index = 0; index < size; index += 1)
		data[index] = (index + seed) & 0xff;
	return data;
}

async function expectDeclined(sourcePath: string, file: Buffer): Promise<void> {
	expect(
		await xuseBgFormat.detect(new BufferByteSource(file), sourcePath),
	).toBe(false);
	expect(await xuseHFormat.detect(new BufferByteSource(file), sourcePath)).toBe(
		false,
	);
}

describe("Xuse bitmap archive", () => {
	it("splits a bg archive into image records", async () => {
		const file = pattern(BG_SMALL_SIZE, 0);
		await expectArchive({
			format: xuseBgFormat,
			sourcePath: "bg001.dat",
			archive: file,
			entries: [{ path: "bg001.dat#0000", size: BG_SMALL_SIZE, content: file }],
			metadata: { entryCount: 1 },
		});
	});

	it("uses the larger record for a lowercase sbg prefix", async () => {
		const file = pattern(BG_LARGE_SIZE, 3);
		const archive = await xuseBgFormat.open(
			new BufferByteSource(file),
			"sbg001.dat",
		);
		expect(archive.entries.map((entry) => entry.size)).toEqual([
			BigInt(BG_LARGE_SIZE),
		]);
	});

	it("keeps the smaller record for an uppercase prefix", async () => {
		const file = pattern(BG_SMALL_SIZE, 3);
		const archive = await xuseBgFormat.open(
			new BufferByteSource(file),
			"SBG001.dat",
		);
		expect(archive.entries.map((entry) => entry.size)).toEqual([
			BigInt(BG_SMALL_SIZE),
		]);
	});

	it("numbers several records", async () => {
		const first = pattern(H_SMALL_SIZE, 0);
		const second = pattern(H_SMALL_SIZE, 7);
		const file = Buffer.concat([first, second]);
		await expectArchive({
			format: xuseHFormat,
			sourcePath: "h001.dat",
			archive: file,
			entries: [
				{ path: "h001.dat#0000", size: H_SMALL_SIZE, content: first },
				{ path: "h001.dat#0001", size: H_SMALL_SIZE, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("uses the larger record for a trailing w", async () => {
		const file = pattern(H_LARGE_SIZE, 5);
		const archive = await xuseHFormat.open(new BufferByteSource(file), "H001W");
		expect(archive.entries.map((entry) => entry.size)).toEqual([
			BigInt(H_LARGE_SIZE),
		]);
	});

	it("ignores whole file names that end with w after an extension", async () => {
		const file = pattern(H_SMALL_SIZE, 5);
		const archive = await xuseHFormat.open(
			new BufferByteSource(file),
			"h001w.dat",
		);
		expect(archive.entries.map((entry) => entry.size)).toEqual([
			BigInt(H_SMALL_SIZE),
		]);
	});

	it("rejects a name without a known prefix", async () => {
		await expectDeclined("other.dat", pattern(BG_SMALL_SIZE, 0));
	});

	it("rejects a record size that leaves a remainder", async () => {
		await expectDeclined("bg001.dat", pattern(BG_SMALL_SIZE + 3, 0));
	});

	it("rejects an empty file", async () => {
		await expectDeclined("bg001.dat", Buffer.alloc(0));
	});

	it("marks the entries as images", async () => {
		const archive = await xuseHFormat.open(
			new BufferByteSource(pattern(H_SMALL_SIZE, 1)),
			"h002.dat",
		);
		expect(archive.entries[0]?.metadata?.type).toBe("image");
	});
});
