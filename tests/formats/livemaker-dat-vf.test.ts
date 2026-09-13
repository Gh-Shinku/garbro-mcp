import { BufferByteSource, FileByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { livemakerVfFormat } from "../../packages/formats/src/livemaker/vf.js";
import { withCompanionFiles } from "../helpers/companion.js";

/**
 * The first sixty four draws of GARbro's `TpRandom` seeded with `0x75D6EE39`, produced by an
 * independent Python transcription. Name bytes take the low byte of each draw, offset masks take the
 * sign extended value, and the generator is reset between the two runs.
 */
const GOLDEN_DRAWS = [
	1977019961, -1022782122, 1158076647, -822531396, -2135637019, -111230542,
	1420867251, 491421624, 139160785, -1622143410, -1838729793, 1373305588,
	253613309, -1049880790, 1022583307, -1499998096, -1228003223, 131971142,
	-1658091625, -2018470868, 474600213, 55053730, -2042678685, 353561128,
	-550141695, -773688514, -1891422609, 1109841508, -1063707091, 953451802,
	-1845655621, 1338676448, 80467609, -1915609290, 988908103, -1668374116,
	-2069883323, 217537938, -1230257645, 120699032, -1714452175, 1994693678,
	-934413537, 1599919572, 1386683229, 320501514, -715439765, -1600178864,
	-1728907063, 1922419238, -1295785737, -206941428, 942312821, -1901350526,
	1060201923, -1311905016, -287537823, 539330846, 378706895, -424412860,
	-145044339, 1251798266, -353923301, 207403456,
];

const FLAG_PACKED = 0;
const FLAG_PLAIN = 1;
const FLAG_SCRAMBLED = 2;
const FLAG_BOTH = 3;

interface VfFixtureEntry {
	name: string;
	data: Buffer;
	flags?: number;
}

interface VfFixtureOptions {
	/** Adds the eight byte reshuffle header and stores the chunks in drawn order. */
	scramble?: { chunkSize: number; seed: number; order: number[] };
	/** Bytes placed in front of the archive; offsets stay relative to the archive. */
	prefix?: Buffer;
	/** Keeps the payloads right behind the header for archives whose index lives in a sibling file. */
	indexExternal?: boolean;
}

interface VfFixture {
	/** The archive as it sits in the file, including any prefix. */
	file: Buffer;
	/** The ten byte header carrying the signature and the count. */
	header: Buffer;
	/** The encrypted names, the offset chain and the flag bytes. */
	index: Buffer;
	/** The entry payloads, in entry order. */
	body: Buffer;
}

/**
 * Builds a LiveMaker archive: a "vff\0" header, the index, and the payloads. The index sits right
 * behind the header, which is where the reference starts reading names.
 */
function buildVf(
	entries: VfFixtureEntry[],
	options: VfFixtureOptions = {},
): VfFixture {
	const prefix = options.prefix ?? Buffer.alloc(0);
	const payloads: Buffer[] = [];
	for (const entry of entries) {
		const flagByte = entry.flags ?? FLAG_PLAIN;
		let data =
			flagByte === FLAG_PACKED || flagByte === FLAG_BOTH
				? deflateSync(entry.data)
				: Buffer.from(entry.data);
		if (
			options.scramble &&
			(flagByte === FLAG_SCRAMBLED || flagByte === FLAG_BOTH)
		) {
			const { chunkSize, seed, order } = options.scramble;
			// Output position `j` reads stored chunk `order[j]`, so the stored chunk at the drawn
			// position holds the matching chunk.
			const count = Math.trunc((data.length - 1) / chunkSize) + 1;
			const ordered: Buffer[] = new Array(count);
			for (let plainIndex = 0; plainIndex < count; plainIndex += 1) {
				const storedIndex = order[plainIndex] ?? plainIndex;
				ordered[storedIndex] = data.subarray(
					plainIndex * chunkSize,
					(plainIndex + 1) * chunkSize,
				);
			}
			const scrambleHeader = Buffer.alloc(8);
			scrambleHeader.writeInt32LE(chunkSize, 0);
			scrambleHeader.writeUInt32LE((seed ^ 0xf8ea) >>> 0, 4);
			data = Buffer.concat([scrambleHeader, ...ordered]);
		}
		payloads.push(data);
	}
	const body = Buffer.concat(payloads);
	// Names consume one draw per byte, then the generator restarts for the offsets.
	const nameParts: Buffer[] = [];
	let draw = 0;
	for (const entry of entries) {
		const name = Buffer.from(entry.name, "latin1");
		const encrypted = Buffer.from(name);
		for (let index = 0; index < name.length; index += 1)
			encrypted[index] =
				(name[index] ?? 0) ^ ((GOLDEN_DRAWS[draw++] ?? 0) & 0xff);
		const length = Buffer.alloc(4);
		length.writeUInt32LE(name.length, 0);
		nameParts.push(length, encrypted);
	}
	const header = Buffer.alloc(10);
	header.writeUInt32LE(0x00666676, 0);
	header.writeUInt16LE(0x100, 4);
	header.writeInt32LE(entries.length, 6);
	const flags = Buffer.from(entries.map((entry) => entry.flags ?? FLAG_PLAIN));
	const namesSize = nameParts.reduce((sum, part) => sum + part.length, 0);
	const indexSize = namesSize + (entries.length + 1) * 8 + flags.length;
	const offsets: number[] = [];
	let position = header.length + (options.indexExternal ? 0 : indexSize);
	for (const payload of payloads) {
		offsets.push(position);
		position += payload.length;
	}
	const offsetParts: Buffer[] = [];
	for (const [index, value] of [...offsets, position].entries()) {
		const stored = Buffer.alloc(8);
		stored.writeBigInt64LE(
			BigInt(value) ^ BigInt.asIntN(64, BigInt(GOLDEN_DRAWS[index] ?? 0)),
		);
		offsetParts.push(stored);
	}
	const index = Buffer.concat([...nameParts, ...offsetParts, flags]);
	return {
		file: Buffer.concat([
			prefix,
			header,
			...(options.indexExternal ? [body] : [index, body]),
		]),
		header,
		index,
		body,
	};
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("livemaker archive", () => {
	it("declines a file without the live maker extension", async () => {
		const { file } = buildVf([{ name: "A.TXT", data: Buffer.from("body") }]);
		expect(await livemakerVfFormat.detect(sourceOf(file), "game.bin")).toBe(
			false,
		);
	});

	it("declines a dat file whose index is missing", async () => {
		const { file } = buildVf([{ name: "A.TXT", data: Buffer.from("body") }]);
		file.writeUInt32LE(0, 0);
		expect(await livemakerVfFormat.detect(sourceOf(file), "game.dat")).toBe(
			false,
		);
	});

	it("declines an insane entry count", async () => {
		const { file } = buildVf([{ name: "A.TXT", data: Buffer.from("body") }]);
		file.writeInt32LE(0x80000, 6);
		expect(await livemakerVfFormat.detect(sourceOf(file), "game.dat")).toBe(
			false,
		);
	});

	it("declines an entry that leaves the archive", async () => {
		const { file } = buildVf([{ name: "A.TXT", data: Buffer.from("body") }]);
		// Corrupt the first offset mask so the entry starts far outside the file.
		file.writeBigInt64LE(0x0fffffffffffn, file.length - 1 - 16);
		expect(await livemakerVfFormat.detect(sourceOf(file), "game.dat")).toBe(
			false,
		);
	});

	it("lists and extracts plainly stored entries", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second");
		const { file } = buildVf([
			{ name: "A.TXT", data: first },
			{ name: "DIR/B.BIN", data: second },
		]);
		const source = sourceOf(file);
		expect(await livemakerVfFormat.detect(source, "game.dat")).toBe(true);
		const archive = await livemakerVfFormat.open(source, "game.dat");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"A.TXT",
				"DIR/B.BIN",
			]);
			expect(archive.entries.map((entry) => Number(entry.size))).toEqual([
				first.length,
				second.length,
			]);
			expect(archive.metadata).toMatchObject({
				entryCount: 2,
				encrypted: true,
			});
			const entry = archive.entries[1];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				second,
			);
		} finally {
			await archive.close();
		}
	});

	it("restores a scrambled entry", async () => {
		const plain = Buffer.from("abcdefghijklmnopqrstuvwx");
		const { file } = buildVf(
			[{ name: "S.BIN", data: plain, flags: FLAG_SCRAMBLED }],
			{ scramble: { chunkSize: 8, seed: 0x1234, order: [1, 0, 2] } },
		);
		const source = sourceOf(file);
		const archive = await livemakerVfFormat.open(source, "game.dat");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.encrypted).toBe(true);
			expect(Number(entry.size)).toBe(plain.length);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				plain,
			);
		} finally {
			await archive.close();
		}
	});

	it("inflates a packed entry", async () => {
		const plain = Buffer.from("compressed payload body");
		const { file } = buildVf([
			{ name: "P.BIN", data: plain, flags: FLAG_PACKED },
		]);
		const archive = await livemakerVfFormat.open(sourceOf(file), "game.dat");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.compressed).toBe(true);
			expect(entry.sizeKnown).toBe(false);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				plain,
			);
		} finally {
			await archive.close();
		}
	});

	it("inflates an entry that is scrambled and packed", async () => {
		const plain = Buffer.from("both flags payload here");
		const { file } = buildVf(
			[{ name: "B.BIN", data: plain, flags: FLAG_BOTH }],
			{ scramble: { chunkSize: 8, seed: 0x1234, order: [1, 0, 2] } },
		);
		const archive = await livemakerVfFormat.open(sourceOf(file), "game.dat");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.encrypted).toBe(true);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				plain,
			);
		} finally {
			await archive.close();
		}
	});

	it("returns an empty stream for a scrambled entry without a body", async () => {
		const { file } = buildVf([
			{ name: "E.BIN", data: Buffer.alloc(8), flags: FLAG_SCRAMBLED },
		]);
		const archive = await livemakerVfFormat.open(sourceOf(file), "game.dat");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.size).toBe(0n);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.alloc(0),
			);
		} finally {
			await archive.close();
		}
	});

	it("reads the index from a sibling ext file", async () => {
		const plain = Buffer.from("ext indexed payload");
		const { header, index, body } = buildVf([{ name: "X.BIN", data: plain }], {
			indexExternal: true,
		});
		// The main file keeps only the payload behind a broken signature; the index moves to the ext
		// file, which repeats the header. Offsets stay relative to the main file.
		const main = Buffer.concat([Buffer.from(header), body]);
		main.fill(0, 0, 4);
		const extFile = Buffer.concat([header, index]);
		await withCompanionFiles(
			"game.dat",
			{ "game.dat": main, "game.ext": extFile },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await livemakerVfFormat.detect(source, mainPath)).toBe(true);
					const archive = await livemakerVfFormat.open(source, mainPath);
					try {
						expect(archive.entries.map((entry) => entry.path)).toEqual([
							"X.BIN",
						]);
						const entry = archive.entries[0];
						if (!entry) throw new Error("missing entry");
						expect(
							await consumeBuffer(await archive.openEntry(entry.id)),
						).toEqual(plain);
					} finally {
						await archive.close();
					}
				} finally {
					await source.close();
				}
			},
		);
	});

	it("reads an archive stored behind an executable overlay", async () => {
		const plain = Buffer.from("overlay payload");
		const { file } = buildVf([{ name: "O.BIN", data: plain }], {
			prefix: Buffer.alloc(0x300),
		});
		const wrapped = wrapInExecutable(file.subarray(0x300));
		await withCompanionFiles(
			"game.exe",
			{ "game.exe": wrapped },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					const archive = await livemakerVfFormat.open(source, mainPath);
					try {
						const entry = archive.entries[0];
						if (!entry) throw new Error("missing entry");
						expect(
							await consumeBuffer(await archive.openEntry(entry.id)),
						).toEqual(plain);
					} finally {
						await archive.close();
					}
				} finally {
					await source.close();
				}
			},
		);
	});

	it("continues the address space through numbered parts", async () => {
		const first = Buffer.from("part one payload");
		const second = Buffer.from("part two payload");
		// Payloads live behind the index so the numbered part continues the payload address space.
		const { file, body } = buildVf([
			{ name: "P1.BIN", data: first },
			{ name: "P2.BIN", data: second },
		]);
		const indexEnd = file.length - body.length;
		await withCompanionFiles(
			"game.dat",
			{
				"game.dat": file.subarray(0, indexEnd),
				"game.001": file.subarray(indexEnd),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await livemakerVfFormat.detect(source, mainPath)).toBe(true);
					const archive = await livemakerVfFormat.open(source, mainPath);
					try {
						expect(archive.metadata).toMatchObject({ parts: 1 });
						const entry = archive.entries[1];
						if (!entry) throw new Error("missing entry");
						expect(
							await consumeBuffer(await archive.openEntry(entry.id)),
						).toEqual(second);
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

/** Wraps a payload in a minimal PE image whose single section ends at 0x300. */
function wrapInExecutable(payload: Buffer): Buffer {
	const stub = Buffer.alloc(0x300);
	stub.write("MZ", 0, "ascii");
	stub.writeUInt32LE(0x40, 0x3c);
	stub.write("PE\0\0", 0x40, "binary");
	stub.writeUInt16LE(1, 0x40 + 6);
	stub.writeUInt16LE(0xe0, 0x40 + 0x14);
	stub.writeUInt32LE(0x200, 0x40 + 0x18 + 0x3c);
	const section = 0x40 + 0xe0 + 0x18;
	stub.writeUInt32LE(0x100, section + 0x10);
	stub.writeUInt32LE(0x200, section + 0x14);
	return Buffer.concat([stub, payload]);
}
