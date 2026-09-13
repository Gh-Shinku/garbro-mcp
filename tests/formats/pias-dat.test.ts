import { BufferByteSource, FileByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { piasDatFormat } from "../../packages/formats/src/pias/dat.js";
import { expectArchive } from "../helpers/archive.js";
import { withCompanionFiles } from "../helpers/companion.js";

/** Encodes an integer the way `TextReader.ReadInt` writes short values. */
function packedInt(value: number): Buffer {
	if (value < 0x40) return Buffer.from([value]);
	if (value < 0x4000) {
		const data = Buffer.alloc(2);
		data.writeUInt16BE(value | 0x4000, 0);
		return data;
	}
	const data = Buffer.alloc(3);
	data.writeUIntBE(value | 0x800000, 0, 3);
	return data;
}

/** Builds a text.dat record set: an opcode, a resource type, a count and the offsets. */
function buildTextDat(
	records: { type: number; offsets: number[] }[],
	options: { signature?: number; opcode?: number; countOverride?: number } = {},
): Buffer {
	const parts: Buffer[] = [];
	if (options.signature !== undefined) {
		const signature = Buffer.alloc(4);
		signature.writeUInt32LE(options.signature >>> 0, 0);
		parts.push(signature);
	}
	for (const record of records) {
		const header = Buffer.concat([
			Buffer.from([options.opcode ?? 0x68]),
			packedInt(record.type),
			packedInt(options.countOverride ?? record.offsets.length),
		]);
		const offsets = Buffer.alloc(record.offsets.length * 4);
		for (const [index, offset] of record.offsets.entries())
			offsets.writeUInt32LE(offset, index * 4);
		parts.push(Buffer.concat([header, offsets]));
	}
	return Buffer.concat(parts);
}

interface ScanEntry {
	/** Payload of the entry. */
	data: Buffer;
	/** Writes the all-ones length marker instead of the payload length. */
	marker?: boolean;
	/** Overrides the stored length word. */
	storedLength?: number;
}

/** Builds a Pias archive: a chain of length prefixed resources from offset zero. */
function buildPias(entries: ScanEntry[]): Buffer {
	const parts: Buffer[] = [];
	for (const entry of entries) {
		if (entry.marker) {
			const marker = Buffer.alloc(4);
			marker.writeUInt32LE(0xffffffff, 0);
			parts.push(marker);
			continue;
		}
		const length = Buffer.alloc(4);
		length.writeUInt32LE(entry.storedLength ?? entry.data.length, 0);
		parts.push(Buffer.concat([length, entry.data]));
	}
	return Buffer.concat(parts);
}

function sourceOf(archive: Buffer): BufferByteSource {
	return new BufferByteSource(archive);
}

describe("pias DAT", () => {
	it("declines a file whose name is not a known archive", async () => {
		const built = buildPias([{ data: Buffer.from("data") }]);
		expect(await piasDatFormat.detect(sourceOf(built), "other.dat")).toBe(
			false,
		);
	});

	it("declines graph.dat without a text.dat companion", async () => {
		const built = buildPias([{ data: Buffer.from("data") }]);
		expect(await piasDatFormat.detect(sourceOf(built), "graph.dat")).toBe(
			false,
		);
	});

	it("declines an encrypted text.dat", async () => {
		await withCompanionFiles(
			"graph.dat",
			{
				"graph.dat": buildPias([{ data: Buffer.from("data") }]),
				"text.dat": buildTextDat([{ type: 1, offsets: [0] }], {
					signature: 0x03184767,
				}),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await piasDatFormat.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});

	it("declines a text.dat with an unknown opcode", async () => {
		await withCompanionFiles(
			"graph.dat",
			{
				"graph.dat": buildPias([{ data: Buffer.from("data") }]),
				"text.dat": buildTextDat([{ type: 1, offsets: [0] }], { opcode: 0x69 }),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await piasDatFormat.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});

	it("declines a matching record with an insane count", async () => {
		await withCompanionFiles(
			"graph.dat",
			{
				"graph.dat": buildPias([{ data: Buffer.from("data") }]),
				"text.dat": buildTextDat([{ type: 1, offsets: [] }], {
					countOverride: 0,
				}),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await piasDatFormat.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});

	it("walks voice.dat with a length prefixed chain", async () => {
		const built = buildPias([
			{ data: Buffer.from("abc") },
			{ data: Buffer.from("defgh") },
		]);
		await expectArchive({
			format: piasDatFormat,
			archive: built,
			sourcePath: "voice.dat",
			entries: [
				{ path: "00000000", size: 7 },
				{ path: "00000007", size: 9 },
			],
		});
	});

	it("wraps an audio entry in a riff container", async () => {
		const built = buildPias([{ data: Buffer.from("abcd") }]);
		const archive = await piasDatFormat.open(sourceOf(built), "voice.dat");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.metadata).toMatchObject({ type: "audio" });
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(48);
			expect(output.toString("latin1", 0, 4)).toBe("RIFF");
			expect(output.readUInt32LE(4)).toBe(0x24 + 4);
			expect(output.toString("latin1", 8, 12)).toBe("WAVE");
			expect(output.readUInt16LE(0x14)).toBe(1);
			expect(output.readUInt16LE(0x16)).toBe(1);
			expect(output.readUInt32LE(0x18)).toBe(22050);
			expect(output.readUInt32LE(0x1c)).toBe(22050);
			expect(output.readUInt16LE(0x20)).toBe(1);
			expect(output.readUInt16LE(0x22)).toBe(8);
			expect(output.readUInt32LE(0x28)).toBe(4);
			expect(output.subarray(44)).toEqual(Buffer.from("abcd"));
		} finally {
			await archive.close();
		}
	});

	it("uses two channels for sound.dat", async () => {
		const built = buildPias([{ data: Buffer.from("abcd") }]);
		await withCompanionFiles(
			"sound.dat",
			{
				"sound.dat": built,
				"text.dat": buildTextDat([{ type: 2, offsets: [0] }]),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					const archive = await piasDatFormat.open(source, mainPath);
					try {
						const entry = archive.entries[0];
						if (!entry) throw new Error("missing entry");
						const output = await consumeBuffer(
							await archive.openEntry(entry.id),
						);
						expect({
							channels: output.readUInt16LE(0x16),
							blockAlign: output.readUInt16LE(0x20),
							byteRate: output.readUInt32LE(0x1c),
						}).toEqual({ channels: 2, blockAlign: 2, byteRate: 44100 });
					} finally {
						await archive.close();
					}
				} finally {
					await source.close();
				}
			},
		);
	});

	it("skips the all ones length marker without adding an entry", async () => {
		const built = buildPias([
			{ data: Buffer.from("abc") },
			{ data: Buffer.alloc(0), marker: true },
			{ data: Buffer.from("de") },
		]);
		const archive = await piasDatFormat.open(sourceOf(built), "voice.dat");
		try {
			expect(
				archive.entries.map((entry) => ({
					path: entry.path,
					size: entry.size,
				})),
			).toEqual([
				{ path: "00000000", size: 7n },
				{ path: "00000011", size: 6n },
			]);
		} finally {
			await archive.close();
		}
	});

	it("declines a chain that leaves the file", async () => {
		const built = buildPias([
			{ data: Buffer.from("abc"), storedLength: 0x1000 },
		]);
		expect(await piasDatFormat.detect(sourceOf(built), "voice.dat")).toBe(
			false,
		);
	});

	it("lists index numbered entries from text.dat", async () => {
		const built = buildPias([{ data: Buffer.from("abcd") }]);
		await withCompanionFiles(
			"graph.dat",
			{
				"graph.dat": built,
				"text.dat": buildTextDat([
					{ type: 2, offsets: [] },
					{ type: 1, offsets: [0] },
				]),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					const archive = await piasDatFormat.open(source, mainPath);
					try {
						expect(
							archive.entries.map((entry) => ({
								path: entry.path,
								size: entry.size,
								type: (entry.metadata as { type?: string }).type,
							})),
						).toEqual([{ path: "0000", size: 12n, type: "image" }]);
					} finally {
						await archive.close();
					}
				} finally {
					await source.close();
				}
			},
		);
	});

	it("reads an image entry through the eight byte header bias", async () => {
		const built = buildPias([{ data: Buffer.from("bitmap01234567") }]);
		await withCompanionFiles(
			"graph.dat",
			{
				"graph.dat": built,
				"text.dat": buildTextDat([{ type: 1, offsets: [0] }]),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					const archive = await piasDatFormat.open(source, mainPath);
					try {
						const entry = archive.entries[0];
						if (!entry) throw new Error("missing entry");
						// The eight byte bias makes the declared size run past the file end, and the
						// extraction is truncated to what the archive actually holds.
						expect(entry.size).toBe(22n);
						expect(
							await consumeBuffer(await archive.openEntry(entry.id)),
						).toEqual(built);
					} finally {
						await archive.close();
					}
				} finally {
					await source.close();
				}
			},
		);
	});

	it("skips a record of another resource type", async () => {
		const built = buildPias([
			{ data: Buffer.from("abcd") },
			{ data: Buffer.from("efgh") },
		]);
		await withCompanionFiles(
			"sound.dat",
			{
				"sound.dat": built,
				"text.dat": buildTextDat([
					{ type: 3, offsets: [0x100, 0x200] },
					{ type: 2, offsets: [0] },
				]),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					const archive = await piasDatFormat.open(source, mainPath);
					try {
						expect(
							archive.entries.map((entry) => [entry.path, entry.size]),
						).toEqual([
							["0000", 8n],
							["00000008", 8n],
						]);
					} finally {
						await archive.close();
					}
				} finally {
					await source.close();
				}
			},
		);
	});
});
