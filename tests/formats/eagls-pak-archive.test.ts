// The resource archives of the EAGLS engine (GARbro "ArcFormats/Eagls/ArcEAGLS.cs", class PakOpener),
// against files built in the test: the index of an archive of the engine stands in a companion file, and
// the places of a picture archive stand of a count of the engine that the archive's first entry names.
import { Buffer } from "node:buffer";
import {
	BufferByteSource,
	FileByteSource,
	GarbroError,
} from "@garbro-mcp/core";
import {
	CRuntimeRandom,
	decryptEaglsIndex,
	decryptEaglsPicture,
	EAGLS_INDEX_KEY,
	eaglsPakFormat,
	LehmerRandom,
} from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { withCompanionFiles } from "../helpers/companion.js";
import { buffer as consumeBuffer } from "node:stream/consumers";

const EAGLS_KEY = Buffer.from("EAGLS_SYSTEM", "latin1");
const LEAST_INDEX = 10000;
const LONG_INDEX = 400000;

/** The places of a name and of an entry of the index, of the two shapes of it of the reference. */
function shape(long: boolean): { names: number; record: number } {
	return long ? { names: 0x18, record: 0x10 } : { names: 0x14, record: 8 };
}

/** The index of an archive of the engine, as it stands behind the cipher, of the counts given. */
function plainIndex(
	entries: { name: string; offset: number; size: number }[],
	long: boolean,
	places: number,
): Buffer {
	const { names, record } = shape(long);
	const out = Buffer.alloc(places, 0x00);
	let at = 0;
	for (const entry of entries) {
		out.write(entry.name, at, "latin1");
		at += names;
		if (long) {
			out.writeBigInt64LE(BigInt(entry.offset), at);
			out.writeUInt32LE(entry.size, at + 8);
		} else {
			out.writeUInt32LE(entry.offset, at);
			out.writeUInt32LE(entry.size, at + 4);
		}
		at += record;
	}
	return out;
}

/** `PakOpener.DecryptIndex` backwards: the places of the index of the engine as they stand in the file. */
function encryptIndex(plain: Buffer, seed: number): Buffer {
	const rng = new CRuntimeRandom();
	rng.sRand(seed);
	const out = Buffer.alloc(plain.length + 4, 0x00);
	for (let at = 0; at < plain.length; at += 1) {
		const key = EAGLS_INDEX_KEY.charCodeAt(rng.rand() % EAGLS_INDEX_KEY.length);
		out[at] = (plain[at] ?? 0) ^ key;
	}
	out.writeInt32LE(seed, plain.length);
	return out;
}

/** The places of the file of the archive: two files one behind the other. */
function payload(size = 0x40): Buffer {
	const out = Buffer.alloc(size, 0x00);
	for (let at = 0; at < size; at += 1) out[at] = (at + 1) & 0xff;
	return out;
}

describe("EAGLS engine resource archive", () => {
	it("reads the counts of the engine of the places of the file of it", () => {
		// The count of the engine of the places of the file stands of the walk of the counts of the
		// engine of the places of `rand` of the reference: from the count of one place it stands of the
		// counts of the places of `rand` of the count of the engine of the counts of the places of it.
		const cruntime = new CRuntimeRandom();
		cruntime.sRand(1);
		expect([0, 1, 2, 3, 4].map(() => cruntime.rand())).toEqual([
			41, 18467, 6334, 26500, 19169,
		]);
		const zero = new CRuntimeRandom();
		zero.sRand(0);
		expect([0, 1, 2].map(() => zero.rand())).toEqual([38, 7719, 21238]);
		// The count of Lehmer, of the counts of Schrage: the counts below stand of a second walk of the
		// same arithmetic, of the same counts, written apart of this project.
		const lehmer = new LehmerRandom();
		lehmer.sRand(1);
		expect([0, 1, 2, 3, 4, 5, 6, 7].map(() => lehmer.rand())).toEqual([
			31, 182, 175, 153, 232, 229, 232, 166,
		]);
	});

	it("reads the places of the index of the engine, of the cipher of it", async () => {
		// The key of the index of the engine, of the reference as it stands there.
		expect(EAGLS_INDEX_KEY).toBe(
			"1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik,9ol.0p;/-@:^[]",
		);
		const plain = plainIndex(
			[
				{ name: "first.g24", offset: 0, size: 0x10 },
				{ name: "second.dat", offset: 0x10, size: 0x30 },
			],
			false,
			LEAST_INDEX,
		);
		expect(decryptEaglsIndex(encryptIndex(plain, 0x1234))).toEqual(plain);
		// The walk of the index of the engine, of the places of the file of it as they stand in the file.
		await withCompanionFiles(
			"sample.pak",
			{
				"sample.pak": payload(),
				"sample.idx": encryptIndex(plain, 0x1234),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await eaglsPakFormat.detect(source, mainPath)).toBe(true);
					const archive = await eaglsPakFormat.open(source, mainPath);
					try {
						expect(archive.entries.map((entry) => entry.path)).toEqual([
							"first.g24",
							"second.dat",
						]);
						expect(archive.entries.map((entry) => entry.size)).toEqual([
							0x10n,
							0x30n,
						]);
						expect(archive.entries[1]?.metadata?.type).toBe("script");
						// An archive whose first entry stands of no picture of the name `.gr` stands of no
						// count at all: the places of its entries stand as they stand.
						const places = await consumeBuffer(
							await archive.openEntry(archive.entries[1]?.id ?? "0"),
						);
						expect(places).toEqual(payload().subarray(0x10, 0x40));
					} finally {
						await archive.close();
					}
				} finally {
					await source.close();
				}
			},
		);
	});

	it("reads the places of the index of the long shape of it", async () => {
		const plain = plainIndex(
			[
				{ name: "long.g", offset: 0, size: 0x20 },
				{ name: "long2.g", offset: 0x20, size: 0x20 },
			],
			true,
			LONG_INDEX,
		);
		await withCompanionFiles(
			"long.pak",
			{ "long.pak": payload(), "long.idx": encryptIndex(plain, 7) },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await eaglsPakFormat.detect(source, mainPath)).toBe(true);
					const archive = await eaglsPakFormat.open(source, mainPath);
					try {
						expect(archive.entries.map((entry) => entry.size)).toEqual([
							0x20n,
							0x20n,
						]);
						expect(archive.metadata?.longOffsets).toBe(true);
					} finally {
						await archive.close();
					}
				} finally {
					await source.close();
				}
			},
		);
	});

	it("reads the places of a picture of the engine, of the count of the picture itself", async () => {
		// A picture of the engine stands of the counts of the file of it, of the count of the last place
		// of it as the count of the cipher: a picture of `BM` at the head of the plain places of the file
		// of it.
		// `DetectEncryptionScheme` reads the word of the places 1 and 2 of the file of a picture
		// (`(ReadInt32 (offset) >> 8) & 0xFFFF`), so a picture of the engine of this name stands of the
		// places `BM` at 1 and 2 rather than at 0 and 1.
		const head = Buffer.from([0x00, 0x42, 0x4d, 0x00, 0x11, 0x22, 0x33, 0x00]);
		const stored = decryptEaglsPicture("lehmer", Buffer.from(head));
		expect(stored).not.toEqual(head);
		expect([...stored.subarray(7)]).toEqual([0x00]);
		const plain = plainIndex(
			[
				{ name: "cg.gr", offset: 0, size: stored.length },
				{ name: "script.dat", offset: stored.length, size: 0x10 },
			],
			false,
			LEAST_INDEX,
		);
		await withCompanionFiles(
			"cg.pak",
			{
				"cg.pak": Buffer.concat([stored, payload(0x10)]),
				"cg.idx": encryptIndex(plain, 0x99),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await eaglsPakFormat.detect(source, mainPath)).toBe(true);
					const archive = await eaglsPakFormat.open(source, mainPath);
					try {
						expect(archive.metadata?.scheme).toBe("cg");
						expect(archive.entries[0]?.encrypted).toBe(true);
						expect(archive.entries[1]?.encrypted).toBe(true);
						const picture = await consumeBuffer(
							await archive.openEntry(archive.entries[0]?.id ?? "0"),
						);
						// The plain places of the file of the picture stand of the count of `BM` at the
						// places 1 and 2 of the picture, of the count the archive itself named.
						expect([...picture.subarray(0, 8)]).toEqual([...head]);
						expect([...picture.subarray(1, 3)]).toEqual([0x42, 0x4d]);
					} finally {
						await archive.close();
					}
				} finally {
					await source.close();
				}
			},
		);
	});

	it("reads the first place of a picture by hand, of the count of the engine", () => {
		// The last place of the file of the picture stands at nought, so the count of the engine begins
		// of nought, of the counts 38, 7719 and 21238 (the walk of the counts of the engine of the counts
		// of the places of `rand`, of the count of the engine of the counts of the places of it, worked out
		// here by hand). `EAGLS_SYSTEM` of the places 38 % 12 = 2, 7719 % 12 = 3 and 21238 % 12 = 10
		// stands of `G`, `L` and `E`, so the first three places of the file stand of `0x42 ^ 0x47`, `L` and
		// `E`.
		const data = Buffer.alloc(0x20, 0x00);
		data[0] = 0x42;
		data[1] = 0x01;
		data[2] = 0x02;
		expect([...decryptEaglsPicture("cruntime", data).subarray(0, 4)]).toEqual([
			0x05, 0x4d, 0x47, 0x41,
		]);
		expect(EAGLS_KEY[38 % EAGLS_KEY.length]).toBe(0x47);
	});

	it("reads no archive whose index stands of no place of the engine, and no short or long index", async () => {
		const plain = plainIndex(
			[{ name: "first.g24", offset: 0, size: 0x10 }],
			false,
			LEAST_INDEX,
		);
		// The places of the index of the engine stand within the counts of the reference: at least the
		// counts of a place of them and at most the counts of the places of the file of it.
		const short = encryptIndex(plain.subarray(0, 9990), 5);
		await withCompanionFiles(
			"short.pak",
			{ "short.pak": payload(), "short.idx": short },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await eaglsPakFormat.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
		// An index of no walk of the engine stands of no entry at all.
		const wrong = encryptIndex(Buffer.alloc(LEAST_INDEX, 0xff), 5);
		await withCompanionFiles(
			"wrong.pak",
			{ "wrong.pak": payload(), "wrong.idx": wrong },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await eaglsPakFormat.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
		// An archive whose first entry stands of a picture of the name `.gr` stands of a count of the
		// engine: where neither of the two counts of the engine stands of its first entry, the reference
		// throws, and so does this port.
		const picture = Buffer.concat([
			Buffer.from([0x01, 0x02, 0x03, 0x04]),
			payload(0x30),
		]);
		const cgPlain = plainIndex(
			[{ name: "cg.gr", offset: 0, size: picture.length }],
			false,
			LEAST_INDEX,
		);
		await withCompanionFiles(
			"nogr.pak",
			{
				"nogr.pak": picture,
				"nogr.idx": encryptIndex(cgPlain, 3),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await eaglsPakFormat.detect(source, mainPath)).toBe(true);
					await expect(eaglsPakFormat.open(source, mainPath)).rejects.toThrow(
						GarbroError,
					);
				} finally {
					await source.close();
				}
			},
		);
		// A file of the name of the index of an archive stands of no archive.
		const indexSource = new BufferByteSource(encryptIndex(plain, 5));
		expect(await eaglsPakFormat.detect(indexSource, "/tmp/sample.idx")).toBe(
			false,
		);
	});
});
