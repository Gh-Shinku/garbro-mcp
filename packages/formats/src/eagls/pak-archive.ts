// Port of GARbro "ArcFormats/Eagls/ArcEAGLS.cs" (tag "PAK/EAGLS", class PakOpener), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. The resource archives of the EAGLS engine.
//
// An archive of this engine carries no index of its own: the index stands in a companion file of the same
// name with the `.idx` extension, every place of it stands of a cipher, and the places of the entries of a
// picture archive stand of a count of the engine's own that the archive's first entry names. The reference
// holds the keys, the count and the walk of that scheme in its own source, so the whole walk is readable
// here:
//
//   * `IndexKey` and `CRuntimeRandomGenerator`, of the cipher of the index,
//   * the detection of the scheme of a picture archive (`DetectEncryptionScheme`), of the two counts of the
//     engine (`CRuntimeRandomGenerator` and `LehmerRandomGenerator`), and the walk that scheme stands of
//     (`CgEncryption`).
//
// What the port does not carry: the reference's other two schemes, `EaglsEncryption` and `AdvSysEncryption`.
// The reference reaches them only through `QueryEncryption()`, i.e. through a question put to the person
// reading the file (`Query<EaglsOptions>`), whose shipped answer holds no scheme at all; with no answer the
// reference hands the entries of such an archive over as they stand, and so does this port. Their own
// arithmetic stands written down in `docs/formats/eagls-pak-archive.md` rather than carried here as code no
// call of this project could reach.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { basename } from "node:path";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const BASELINE_COMMIT = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";

/** `PakOpener.IndexKey`: the key of the places of the index of the engine. */
export const EAGLS_INDEX_KEY = "1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik,9ol.0p;/-@:^[]";
/** `PakOpener.EaglsKey`: the key of the pictures of the engine. */
const EAGLS_KEY = Buffer.from("EAGLS_SYSTEM", "latin1");
/** `TryOpen`: the places of the companion index stand within these counts, of no walk past them. */
const LEAST_INDEX = 10000;
const MOST_INDEX = 0xfffff;
/** `TryOpen`: the count of the entries of the index stands of its own places over this count. */
const INDEX_DIVISOR = 10000;
/** The places of a name and of the places of an entry, of the two shapes of the index. */
const MOST_ENTRY_PLACES = 40;
const NAME_PLACES_SHORT = 0x14;
const NAME_PLACES_LONG = 0x18;
const RECORD_PLACES_SHORT = 8;
const RECORD_PLACES_LONG = 0x10;
/** `CgEncryption`: the count of the places of a picture of the engine, at most. */
const MOST_PICTURE_PLACES = 0x174b;
/** The first word of a picture of the engine, standing little endian. */
const BMP_WORD = 0x4d42;

/** A count of the engine's own arithmetic, of the two shapes of it. */
export interface EaglsRandom {
	sRand(seed: number): void;
	rand(): number;
}

/** `CRuntimeRandomGenerator`: the count of the walk of the engine of the places of the file of it. */
export class CRuntimeRandom implements EaglsRandom {
	#seed = 0;

	sRand(seed: number): void {
		this.#seed = seed >>> 0;
	}

	rand(): number {
		this.#seed = (Math.imul(this.#seed, 214013) + 2531011) >>> 0;
		return (this.#seed >>> 16) & 0x7fff;
	}
}

/** `LehmerRandomGenerator`: the count of the walk of Lehmer, of the counts of Schrage. */
export class LehmerRandom implements EaglsRandom {
	#seed = 0;

	sRand(seed: number): void {
		this.#seed = (seed ^ 123459876) | 0;
	}

	rand(): number {
		const quotient = Math.trunc(this.#seed / 44488);
		const remainder = this.#seed % 44488;
		let seed = (Math.imul(48271, remainder) - 3399 * quotient) | 0;
		if (seed < 0) seed = (seed + 2147483647) | 0;
		this.#seed = seed;
		return Math.trunc(seed * 4.656612875245797e-10 * 256);
	}
}

/** The two counts the reference stands of over the places of a picture, in the reference's own order. */
export function eaglsRandoms(): EaglsRandom[] {
	return [new LehmerRandom(), new CRuntimeRandom()];
}

/**
 * `PakOpener.DecryptIndex`: the places of the index of the engine, of the cipher of its own. The last four
 * places of the file stand as they stand and hold the count the walk of the cipher begins of.
 */
export function decryptEaglsIndex(index: Buffer): Buffer | undefined {
	if (index.length < 4) return undefined;
	const size = index.length - 4;
	const rng = new CRuntimeRandom();
	rng.sRand(index.readInt32LE(size));
	const out = Buffer.alloc(size);
	for (let at = 0; at < size; at += 1) {
		out[at] =
			(index[at] ?? 0) ^
			EAGLS_INDEX_KEY.charCodeAt(rng.rand() % EAGLS_INDEX_KEY.length);
	}
	return out;
}

/** One entry of the index of an archive of the engine. */
export interface EaglsEntry {
	name: string;
	offset: bigint;
	size: bigint;
	/** `TryOpen`: a file of the name `.dat` stands of a script of the engine. */
	script: boolean;
	/** `TryOpen`: a count of `0x18` places rather than `0x14` stands of the places of an entry. */
	longOffsets: boolean;
}

/** `TryOpen`: the entries of the index of the engine, of the places of the index itself. */
export function walkEaglsIndex(
	index: Buffer,
	sourceSize: bigint,
): EaglsEntry[] | undefined {
	let entryPlaces = Math.trunc(index.length / INDEX_DIVISOR);
	if (entryPlaces > MOST_ENTRY_PLACES) entryPlaces = MOST_ENTRY_PLACES;
	const longOffsets = MOST_ENTRY_PLACES === entryPlaces;
	const namePlaces = longOffsets ? NAME_PLACES_LONG : NAME_PLACES_SHORT;
	const recordPlaces = longOffsets ? RECORD_PLACES_LONG : RECORD_PLACES_SHORT;
	if (index.length < namePlaces + recordPlaces) return undefined;
	const firstOffset = BigInt(index.readUInt32LE(namePlaces));
	const entries: EaglsEntry[] = [];
	let at = 0;
	while (at < index.length) {
		if (0 === index[at]) break;
		if (at + namePlaces + recordPlaces > index.length) return undefined;
		const name = decodeCStringField(index, at, namePlaces);
		at += namePlaces;
		const offset = longOffsets
			? index.readBigInt64LE(at) - firstOffset
			: BigInt((index.readUInt32LE(at) - Number(firstOffset)) >>> 0);
		const size = BigInt(index.readUInt32LE(at + (longOffsets ? 8 : 4)));
		at += recordPlaces;
		if (!checkPlacement(offset, size, sourceSize)) return undefined;
		entries.push({
			name,
			offset,
			size,
			script: /\.dat$/i.test(name),
			longOffsets,
		});
	}
	if (0 === entries.length) return undefined;
	return entries;
}

/** The scheme of the places of the pictures of an archive of the engine. */
export type EaglsScheme =
	| { kind: "plain" }
	/** `CgEncryption`, of one of the two counts of the engine. */
	| { kind: "cg"; random: "lehmer" | "cruntime" };

/**
 * `PakOpener.DetectEncryptionScheme`: the places of a picture of the engine stand of a count of the
 * engine's own, of a count the first entry of the archive names. A first entry that already stands of `BM`
 * stands of no count at all, and the reference throws where neither of its two counts stands of `BM` as
 * well.
 */
export async function detectEaglsScheme(
	source: ByteSource,
	first: EaglsEntry,
): Promise<EaglsScheme | undefined> {
	if (first.size < 4n) return undefined;
	const head = await source.readAt(first.offset, 4);
	const signature = ((head.readInt32LE(0) >> 8) & 0xffff) >>> 0;
	if (BMP_WORD === signature) return { kind: "plain" };
	const seed = (await source.readAt(first.offset + first.size - 1n, 1))[0] ?? 0;
	const kinds: ("lehmer" | "cruntime")[] = ["lehmer", "cruntime"];
	const randoms = eaglsRandoms();
	for (let at = 0; at < randoms.length; at += 1) {
		const rng = randoms[at];
		if (!rng) continue;
		rng.sRand(seed);
		rng.rand(); // the reference stands of one count of the cipher of the picture first
		let test = signature;
		test ^= EAGLS_KEY[rng.rand() % EAGLS_KEY.length] ?? 0;
		test ^= (EAGLS_KEY[rng.rand() % EAGLS_KEY.length] ?? 0) << 8;
		if (BMP_WORD === (test & 0xffff)) {
			return { kind: "cg", random: kinds[at] ?? "cruntime" };
		}
	}
	return undefined;
}

/** `CgEncryption.Decrypt`: the places of a picture of the engine, of the count of the picture itself. */
export function decryptEaglsPicture(
	kind: "lehmer" | "cruntime",
	data: Buffer,
): Buffer {
	if (0 === data.length) return data;
	const rng = "lehmer" === kind ? new LehmerRandom() : new CRuntimeRandom();
	rng.sRand(data[data.length - 1] ?? 0);
	const limit = Math.min(data.length - 1, MOST_PICTURE_PLACES);
	for (let at = 0; at < limit; at += 1) {
		data[at] =
			(data[at] ?? 0) ^ (EAGLS_KEY[rng.rand() % EAGLS_KEY.length] ?? 0);
	}
	return data;
}

export const eaglsPakDescriptor: FormatDescriptor = {
	id: "eagls-pak-archive",
	name: "EAGLS engine resource archive",
	extensions: ["pak"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Eagls/ArcEAGLS.cs",
			license: "MIT",
			commit: BASELINE_COMMIT,
		},
	],
};

/** The walked index of an archive of the engine. */
async function readEaglsIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<EaglsEntry[] | undefined> {
	if (/\.idx$/i.test(basename(sourcePath))) return undefined;
	const name = basename(changeExtension(sourcePath, "idx"));
	const index = await readCompanionFile(sourcePath, name);
	if (!index) return undefined;
	if (index.length < LEAST_INDEX || index.length > MOST_INDEX) return undefined;
	const places = decryptEaglsIndex(index);
	if (!places) return undefined;
	const walked = walkEaglsIndex(places, source.size);
	return walked;
}

export const eaglsPakEntryOpener: FixedEntryOpener = async (source, entry) => {
	const data = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	if (!entry.encrypted) return Readable.from([data]);
	const kind = entry.metadata?.random;
	if ("lehmer" !== kind && "cruntime" !== kind) return Readable.from([data]);
	return Readable.from([decryptEaglsPicture(kind, data)]);
};

export const eaglsPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: eaglsPakDescriptor,
	detection: {
		signatures: [],
		priority: -1,
		extensionFallback: true,
	},
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readEaglsIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const walked = await readEaglsIndex(source, sourcePath);
		if (!walked) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Not an archive of the engine EAGLS: its index stands in no companion file of that name, or the places of it stand of no walk of this engine",
			);
		}
		const first = walked[0];
		if (!first)
			throw new GarbroError("INVALID_ARCHIVE", "The index holds no entry");
		// `TryOpen`: an archive whose first entry stands of a picture of the name `.gr` stands of a count of
		// the engine, and its own files of the places of a picture and of a script stand of that count. The
		// reference throws where neither of the two counts of the engine stands of its first entry; this port
		// stands of the same refusal, named as such.
		let scheme: EaglsScheme = { kind: "plain" };
		if (/\.gr$/i.test(first.name)) {
			const found = await detectEaglsScheme(source, first);
			if (!found) {
				throw new GarbroError(
					"UNSUPPORTED_FEATURE",
					"The places of the pictures of this archive stand of no count of the engine this port stands of",
				);
			}
			scheme = found;
		}
		const entries: FixedEntry[] = walked.map((entry, id) => {
			const encrypted = "cg" === scheme.kind && /\.(dat|gr)$/i.test(entry.name);
			return {
				...createFixedEntry({
					id,
					...normalizeEntryPath(entry.name),
					offset: entry.offset,
					size: entry.size,
					encrypted,
					metadata: {
						type: entry.script ? "script" : "data",
						...(encrypted && "cg" === scheme.kind
							? { random: scheme.random }
							: {}),
					} as Record<string, unknown>,
				}),
				sizeKnown: true,
			};
		});
		return {
			entries,
			metadata: {
				count: entries.length,
				scheme: "cg" === scheme.kind ? "cg" : "plain",
				longOffsets: first.longOffsets,
			},
		};
	},
	openEntry: eaglsPakEntryOpener,
});
