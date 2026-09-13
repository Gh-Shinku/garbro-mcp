import { FileByteSource } from "@garbro-mcp/core";
import { ozFormat } from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";

const SIGNATURE = Buffer.from([0x4f, 0x5a, 0x00, 0x01]);

interface Spec {
	region: Buffer;
	/** Expected unpacked size, which is the region size for a plain payload. */
	size?: number;
}

/** A region with a `DFLT` header around a zlib stream. */
function dflt(plain: Buffer): Buffer {
	const packed = deflateSync(plain);
	const header = Buffer.alloc(12);
	header.write("DFLT", 0, "latin1");
	header.writeUInt32LE(packed.length, 4);
	header.writeUInt32LE(plain.length, 8);
	return Buffer.concat([header, packed]);
}

/** A region with a `DATA` header around an uncompressed payload. */
function data(payload: Buffer): Buffer {
	const header = Buffer.alloc(8);
	header.write("DATA", 0, "latin1");
	header.writeUInt32LE(payload.length, 4);
	return Buffer.concat([header, payload]);
}

/** Lays out the header, the offset table and the payload regions. */
function buildOz(specs: readonly Spec[]): Buffer {
	const table = Buffer.alloc(specs.length * 4);
	let cursor = 12 + table.length;
	for (const [id, spec] of specs.entries()) {
		table.writeUInt32LE(cursor, id * 4);
		cursor += spec.region.length;
	}
	const header = Buffer.alloc(12);
	SIGNATURE.copy(header, 0);
	header.write("OFST", 4, "latin1");
	header.writeInt32LE(table.length, 8);
	return Buffer.concat([header, table, ...specs.map((spec) => spec.region)]);
}

async function expectDeclined(file: Buffer): Promise<void> {
	await withCompanionFiles(
		"sample.bin",
		{ "sample.bin": file },
		async (mainPath) => {
			const source = await FileByteSource.open(mainPath);
			expect(await ozFormat.detect(source, mainPath)).toBe(false);
		},
	);
}

describe("Patisserie resource archive", () => {
	it("reads plain payloads and takes names from a sibling list", async () => {
		const first = Buffer.from("plain first payload");
		const second = Buffer.from("plain second payload");
		await withCompanionFiles(
			"sample.bin",
			{
				"sample.bin": buildOz([{ region: first }, { region: second }]),
				"sample.lst": "first.dat\nsecond.dat\r\n",
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: ozFormat,
					mainPath,
					entries: [
						{ path: "first.dat", size: first.length, content: first },
						{ path: "second.dat", size: second.length, content: second },
					],
					metadata: { entryCount: 2 },
				});
			},
		);
	});

	it("generates numbered names when no list is present", async () => {
		const payload = Buffer.from("payload without a name list");
		await withCompanionFiles(
			"sample.bin",
			{ "sample.bin": buildOz([{ region: payload }]) },
			async (mainPath) => {
				await expectCompanionArchive({
					format: ozFormat,
					mainPath,
					entries: [
						{ path: "sample#00000", size: payload.length, content: payload },
					],
				});
			},
		);
	});

	it("unpacks packed and data payloads", async () => {
		const packed = Buffer.from("payload inside a dflt header");
		const unpacked = Buffer.from("payload inside a data header");
		await withCompanionFiles(
			"sample.bin",
			{
				"sample.bin": buildOz([
					{ region: dflt(packed) },
					{ region: data(unpacked) },
				]),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: ozFormat,
					mainPath,
					entries: [
						{ path: "sample#00000", size: packed.length, content: packed },
						{ path: "sample#00001", size: unpacked.length, content: unpacked },
					],
				});
			},
		);
	});

	it("names audio archives after their content", async () => {
		const payload = Buffer.from("audio bytes");
		await withCompanionFiles(
			"bgmflac.bin",
			{ "bgmflac.bin": buildOz([{ region: payload }]) },
			async (mainPath) => {
				await expectCompanionArchive({
					format: ozFormat,
					mainPath,
					entries: [
						{ path: "bgm#00000.flac", size: payload.length, content: payload },
					],
				});
			},
		);
	});

	it("detects audio payloads inside a data header", async () => {
		const flac = Buffer.concat([
			Buffer.from("fLaC", "latin1"),
			Buffer.from([0, 0, 0, 1]),
		]);
		const riff = Buffer.concat([
			Buffer.from("RIFF", "latin1"),
			Buffer.from([0, 0, 0, 0]),
		]);
		await withCompanionFiles(
			"sample.bin",
			{
				"sample.bin": buildOz([{ region: data(flac) }, { region: data(riff) }]),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: ozFormat,
					mainPath,
					entries: [
						{ path: "sample#00000.flac", size: flac.length, content: flac },
						{ path: "sample#00001.wav", size: riff.length, content: riff },
					],
				});
			},
		);
	});

	it("reads names from the shared list index", async () => {
		const payload = Buffer.from("shared list payload");
		const names = Buffer.from("shared.dat\nother.dat\n", "latin1");
		await withCompanionFiles(
			"sample.bin",
			{
				"sample.bin": buildOz([{ region: payload }]),
				"lists.lst": "alpha.bin\nsample\n",
				"lists.bin": buildOz([
					{ region: Buffer.from("unused", "latin1") },
					{ region: data(names) },
				]),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: ozFormat,
					mainPath,
					entries: [
						{ path: "shared.dat", size: payload.length, content: payload },
					],
				});
			},
		);
	});

	it("rejects a broken index marker", async () => {
		const file = buildOz([{ region: Buffer.from("payload", "latin1") }]);
		file.write("XFST", 4, "latin1");
		await expectDeclined(file);
	});

	it("rejects an index without entries", async () => {
		const file = buildOz([{ region: Buffer.from("payload", "latin1") }]);
		file.writeInt32LE(0, 8);
		await expectDeclined(file);
	});

	it("rejects an offset table that runs backwards", async () => {
		const file = buildOz([
			{ region: Buffer.from("first", "latin1") },
			{ region: Buffer.from("second", "latin1") },
		]);
		file.writeUInt32LE(0x0c, 0x10);
		await expectDeclined(file);
	});

	it("rejects an entry that leaves the file", async () => {
		const file = buildOz([
			{ region: Buffer.from("first", "latin1") },
			{ region: Buffer.from("second", "latin1") },
		]);
		file.writeUInt32LE(0xffff, 0x10);
		await expectDeclined(file);
	});
});
