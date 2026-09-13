import { FileByteSource } from "@garbro-mcp/core";
import { gssLsdFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";

const BIN_SIGNATURE = "LSDARC V.100";
const BIN_INDEX_START = 0x10;
const PAYLOAD_HEADER_SIZE = 12;

interface Spec {
	name: string;
	/** Stored bytes in the arc file. */
	stored: Buffer;
	/** Unpacked size recorded in the index. */
	unpackedSize?: number;
	packed?: boolean;
	/** Overrides the payload offset recorded in the index. */
	offsetOverride?: number;
}

/** Builds the sibling `BIN` index. */
function buildBin(specs: readonly Spec[]): Buffer {
	const header = Buffer.alloc(BIN_INDEX_START);
	header.write(BIN_SIGNATURE, 0, "latin1");
	header.writeInt32LE(specs.length, 0xc);
	const records: Buffer[] = [];
	let offset = 0;
	for (const spec of specs) {
		const name = Buffer.concat([
			Buffer.from(spec.name, "latin1"),
			Buffer.from([0]),
		]);
		const record = Buffer.alloc(16 + name.length);
		record.writeInt32LE(spec.packed ? 1 : 0, 0);
		record.writeUInt32LE(spec.offsetOverride ?? offset, 4);
		record.writeUInt32LE(spec.unpackedSize ?? spec.stored.length, 8);
		record.writeUInt32LE(spec.stored.length, 12);
		name.copy(record, 16);
		records.push(record);
		offset += spec.stored.length;
	}
	return Buffer.concat([header, ...records]);
}

/** Builds the arc file: the stored payloads laid out in record order. */
function buildArc(specs: readonly Spec[]): Buffer {
	return Buffer.concat(specs.map((spec) => spec.stored));
}

/** Wraps a compressed `stream` in the twelve byte payload header the opener expects. */
function payload(
	stream: Buffer,
	packMethod: string,
	unpackedSize: number,
): Buffer {
	const header = Buffer.alloc(PAYLOAD_HEADER_SIZE);
	header.write("LSD\u001a", 0, "latin1");
	header.writeUInt8(0x42, 4);
	header.write(packMethod, 5, "latin1");
	header.writeUInt32LE(unpackedSize, 6);
	return Buffer.concat([header, stream]);
}

/** Encodes `data` as R commands: a literal run, then the end marker. */
function rLiterals(data: Buffer): Buffer {
	const chunks: Buffer[] = [];
	for (let offset = 0; offset < data.length; offset += 0x3f) {
		const run = data.subarray(offset, Math.min(offset + 0x3f, data.length));
		chunks.push(Buffer.from([0x40 | run.length]), run);
	}
	chunks.push(Buffer.from([0xf0]));
	return Buffer.concat(chunks);
}

async function archiveCase(
	specs: readonly Spec[],
	run: (mainPath: string) => Promise<void>,
): Promise<void> {
	await withCompanionFiles(
		"game.arc",
		{ "game.arc": buildArc(specs), "game.BIN": buildBin(specs) },
		run,
	);
}

describe("GSS engine resource archive", () => {
	it("reads an unpacked entry", async () => {
		const stored = Buffer.from("plain gss payload");
		await archiveCase([{ name: "FIRST.DAT", stored }], (mainPath) =>
			expectCompanionArchive({
				format: gssLsdFormat,
				mainPath,
				entries: [{ path: "FIRST.DAT", size: stored.length, content: stored }],
			}),
		);
	});

	it("unpacks an R compressed entry", async () => {
		const unpacked = Buffer.from("gss r compressed payload");
		const stored = payload(rLiterals(unpacked), "R", unpacked.length);
		await archiveCase(
			[
				{
					name: "SECOND.DAT",
					stored,
					packed: true,
					unpackedSize: unpacked.length,
				},
			],
			(mainPath) =>
				expectCompanionArchive({
					format: gssLsdFormat,
					mainPath,
					entries: [
						{ path: "SECOND.DAT", size: unpacked.length, content: unpacked },
					],
				}),
		);
	});

	it("unpacks an R fill command", async () => {
		// A five byte run of 0x41 followed by the end marker.
		const data = Buffer.concat([
			Buffer.from([0x85, 0x41]),
			Buffer.from([0xf0]),
		]);
		const stored = payload(data, "R", 5);
		const unpacked = Buffer.alloc(5, 0x41);
		await archiveCase(
			[{ name: "FILL.DAT", stored, packed: true, unpackedSize: 5 }],
			(mainPath) =>
				expectCompanionArchive({
					format: gssLsdFormat,
					mainPath,
					entries: [{ path: "FILL.DAT", size: 5, content: unpacked }],
				}),
		);
	});

	it("unpacks an R skip command", async () => {
		// Skip three bytes, then write two literals.
		const data = Buffer.from([0x03, 0x42, 0x41, 0x42, 0xf0]);
		const stored = payload(data, "R", 5);
		const unpacked = Buffer.from([0, 0, 0, 0x41, 0x42]);
		await archiveCase(
			[{ name: "SKIP.DAT", stored, packed: true, unpackedSize: 5 }],
			(mainPath) =>
				expectCompanionArchive({
					format: gssLsdFormat,
					mainPath,
					entries: [{ path: "SKIP.DAT", size: 5, content: unpacked }],
				}),
		);
	});

	it("unpacks an R extended literal run", async () => {
		const body = Buffer.alloc(0x100, 0x5a);
		// 0xD0 carries the high count bits, the next byte the low ones.
		const data = Buffer.concat([
			Buffer.from([0xd1, 0x00]),
			body,
			Buffer.from([0xf0]),
		]);
		const stored = payload(data, "R", body.length);
		await archiveCase(
			[{ name: "LONG.DAT", stored, packed: true, unpackedSize: body.length }],
			(mainPath) =>
				expectCompanionArchive({
					format: gssLsdFormat,
					mainPath,
					entries: [{ path: "LONG.DAT", size: body.length, content: body }],
				}),
		);
	});

	it("stops at the end marker", async () => {
		const data = Buffer.from([0x42, 0x41, 0x42, 0xf0, 0x42, 0x43]);
		const stored = payload(data, "R", 2);
		await archiveCase(
			[{ name: "END.DAT", stored, packed: true, unpackedSize: 2 }],
			(mainPath) =>
				expectCompanionArchive({
					format: gssLsdFormat,
					mainPath,
					entries: [
						{ path: "END.DAT", size: 2, content: Buffer.from([0x41, 0x42]) },
					],
				}),
		);
	});

	it("leaves a payload without the LSD signature alone", async () => {
		const stored = Buffer.from("not an lsd payload at all");
		await archiveCase(
			[{ name: "RAW.DAT", stored, packed: true, unpackedSize: stored.length }],
			(mainPath) =>
				expectCompanionArchive({
					format: gssLsdFormat,
					mainPath,
					entries: [{ path: "RAW.DAT", size: stored.length, content: stored }],
				}),
		);
	});

	it("copies payloads with an unknown pack method", async () => {
		const stored = payload(Buffer.from([1, 2, 3, 4]), "Z", 4);
		await archiveCase(
			[{ name: "COPY.DAT", stored, packed: true, unpackedSize: 4 }],
			(mainPath) =>
				expectCompanionArchive({
					format: gssLsdFormat,
					mainPath,
					entries: [
						{
							path: "COPY.DAT",
							size: 4,
							content: Buffer.from([1, 2, 3, 4]),
						},
					],
				}),
		);
	});

	it("reports packed entries with an unknown size", async () => {
		const unpacked = Buffer.from("gss r compressed payload");
		const stored = payload(rLiterals(unpacked), "R", unpacked.length);
		await archiveCase(
			[
				{
					name: "SIZE.DAT",
					stored,
					packed: true,
					unpackedSize: unpacked.length,
				},
			],
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					const archive = await gssLsdFormat.open(source, mainPath);
					try {
						expect(archive.entries[0]).toMatchObject({
							path: "SIZE.DAT",
							size: BigInt(unpacked.length),
							sizeKnown: false,
							compressed: true,
							packedSize: BigInt(stored.length),
						});
						expect(archive.metadata?.entryCount).toBe(1);
					} finally {
						await archive.close();
					}
				} finally {
					await source.close();
				}
			},
		);
	});

	it("rejects the unsupported pack methods", async () => {
		for (const method of ["D", "H", "W"]) {
			const stored = payload(Buffer.from([1, 2, 3, 4]), method, 4);
			await archiveCase(
				[{ name: "U.DAT", stored, packed: true, unpackedSize: 4 }],
				async (mainPath) => {
					const source = await FileByteSource.open(mainPath);
					try {
						const archive = await gssLsdFormat.open(source, mainPath);
						try {
							await expect(
								archive.openEntry(archive.entries[0]?.id ?? "0"),
							).rejects.toMatchObject({ code: "UNSUPPORTED_FEATURE" });
						} finally {
							await archive.close();
						}
					} finally {
						await source.close();
					}
				},
			);
		}
	});

	it("falls back to a lowercase companion name", async () => {
		const stored = Buffer.from("lowercase companion");
		await withCompanionFiles(
			"game.arc",
			{ "game.arc": stored, "game.bin": buildBin([{ name: "A.DAT", stored }]) },
			(mainPath) =>
				expectCompanionArchive({
					format: gssLsdFormat,
					mainPath,
					entries: [{ path: "A.DAT", size: stored.length, content: stored }],
				}),
		);
	});

	it("declines without a companion index", async () => {
		const stored = Buffer.from("no companion");
		await withCompanionFiles(
			"game.arc",
			{ "game.arc": stored },
			async (path) => {
				const source = await FileByteSource.open(path);
				try {
					expect(await gssLsdFormat.detect(source, path)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});

	it("declines a foreign companion signature", async () => {
		const stored = Buffer.from("foreign index");
		await withCompanionFiles(
			"game.arc",
			{
				"game.arc": stored,
				"game.BIN": Buffer.concat([
					Buffer.from("NOTLSDARC V.1", "latin1"),
					Buffer.alloc(0x20),
				]),
			},
			async (path) => {
				const source = await FileByteSource.open(path);
				try {
					expect(await gssLsdFormat.detect(source, path)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});

	it("declines an index without records", async () => {
		const stored = Buffer.from("empty index");
		await withCompanionFiles(
			"game.arc",
			{ "game.arc": stored, "game.BIN": buildBin([]) },
			async (path) => {
				const source = await FileByteSource.open(path);
				try {
					expect(await gssLsdFormat.detect(source, path)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});

	it("declines a truncated index record", async () => {
		const stored = Buffer.from("truncated index");
		const bin = buildBin([{ name: "A.DAT", stored }]).subarray(
			0,
			BIN_INDEX_START + 20,
		);
		await withCompanionFiles(
			"game.arc",
			{ "game.arc": stored, "game.BIN": bin },
			async (path) => {
				const source = await FileByteSource.open(path);
				try {
					expect(await gssLsdFormat.detect(source, path)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});

	it("declines a payload outside the arc file", async () => {
		const stored = Buffer.from("placement");
		await withCompanionFiles(
			"game.arc",
			{
				"game.arc": stored,
				"game.BIN": buildBin([
					{ name: "A.DAT", stored, offsetOverride: 0x1000 },
				]),
			},
			async (path) => {
				const source = await FileByteSource.open(path);
				try {
					expect(await gssLsdFormat.detect(source, path)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});

	it("declines an owner with another extension", async () => {
		const stored = Buffer.from("wrong extension");
		await withCompanionFiles(
			"game.bin",
			{ "game.bin": stored, "game.BIN": buildBin([{ name: "A.DAT", stored }]) },
			async (path) => {
				const source = await FileByteSource.open(path);
				try {
					expect(await gssLsdFormat.detect(source, path)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});
});
