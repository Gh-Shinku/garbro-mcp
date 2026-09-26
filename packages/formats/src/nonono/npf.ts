// Format reference: GARbro ArcFormats/Nonono/ArcNPF.cs, classes `NpfOpener`, `RandomGenerator1` and
// `RandomGenerator2`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { IMGX_SIGNATURE, unpackImgx } from "./imgx.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = 0x4b434150; // 'PACK'
const SIGNATURE_VERSION = 4;
const SIGNATURE_SUBVERSION = 1;
/** The directory header sits behind the three signature words. */
const HEADER_OFFSET = 12;
const HEADER_SIZE = 20;
const INDEX_OFFSET = 0x20;
const RECORD_SIZE = 20;
/** The decrypted header opens with this marker and carries the entry count. */
const HEADER_MARKER = "FAT ";
const COUNT_FIELD = 8;
/** Fields inside an index record. */
const SEED_FIELD = 8;
const NAME_LENGTH_FIELD = 12;
const OFFSET_FIELD = 4;
const SIZE_FIELD = 16;
const MAX_NAME_LENGTH = 0x100;
/** Both generators are seeded with this value before the header is decrypted. */
const DEFAULT_SEED = 0x46415420; // 'FAT '

/** GARBro `IRandomGenerator`. */
interface RandomGenerator {
	srand(seed: number): void;
	rand(): number;
}

/** GARBro `RandomGenerator1`, seeded with `DefaultSeed` when it is constructed. */
class RandomGenerator1 implements RandomGenerator {
	#seed: number;

	constructor(seed = DEFAULT_SEED) {
		this.#seed = 0;
		this.srand(seed);
	}

	srand(seed: number): void {
		this.#seed = seed | 0;
		for (let i = 0; i < 32; i += 1) this.rand();
	}

	rand(): number {
		this.#seed = (this.#seed ^ 0x65ac9365) | 0;
		const left = ((this.#seed >> 1) ^ this.#seed) >> 3;
		const right = ((this.#seed << 1) ^ this.#seed) << 3;
		this.#seed = (this.#seed ^ (left ^ right)) | 0;
		return this.#seed;
	}
}

/** GARBro `RandomGenerator2`. */
class RandomGenerator2 implements RandomGenerator {
	#seed1 = 0;
	#seed2 = 0;

	constructor(seed = DEFAULT_SEED) {
		this.srand(seed);
	}

	srand(seed: number): void {
		this.#seed1 = seed | 0;
		this.#seed2 = (((seed >> 12) ^ (seed << 18)) - 0x579e2b8d) | 0;
	}

	rand(): number {
		const next =
			(this.#seed2 + ((this.#seed1 >> 10) ^ (this.#seed1 << 14))) | 0;
		this.#seed2 =
			(next - 0x15633649 + ((this.#seed2 >> 12) ^ (this.#seed2 << 18))) | 0;
		return this.#seed2;
	}
}

/** GARBro `NpfOpener.Decrypt`: every byte is exclusive-ored with the low byte of a generator value. */
function decrypt(data: Buffer, generator: RandomGenerator): void {
	for (let i = 0; i < data.length; i += 1)
		data[i] = ((data[i] ?? 0) ^ (generator.rand() & 0xff)) & 0xff;
}

interface NpfEntryState {
	seed: number;
	generator: 1 | 2;
}

function entryState(entry: FixedEntry): NpfEntryState | undefined {
	const metadata = entry.metadata;
	if (metadata === undefined) return undefined;
	const seed = metadata.seed;
	const generator = metadata.generator;
	if (typeof seed !== "number") return undefined;
	if (generator !== 1 && generator !== 2) return undefined;
	return { seed, generator };
}

/** Reads and decrypts the directory with one of the two generators the reference tries. */
async function readIndex(
	source: ByteSource,
	generator: RandomGenerator,
	kind: 1 | 2,
): Promise<FixedEntry[] | undefined> {
	const header = Buffer.from(
		await source.readAt(BigInt(HEADER_OFFSET), HEADER_SIZE),
	);
	decrypt(header, generator);
	if (header.subarray(0, 4).toString("latin1") !== HEADER_MARKER)
		return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const indexSize = RECORD_SIZE * count;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = Buffer.from(
		await source.readAt(BigInt(INDEX_OFFSET), indexSize),
	);
	generator.srand(count);
	decrypt(index, generator);

	const entries: FixedEntry[] = [];
	let namePosition = INDEX_OFFSET + indexSize;
	for (let i = 0; i < count; i += 1) {
		const cursor = i * RECORD_SIZE;
		const nameLength = index.readInt32LE(cursor + NAME_LENGTH_FIELD);
		if (nameLength <= 0 || nameLength > MAX_NAME_LENGTH) return undefined;
		if (BigInt(namePosition + nameLength) > source.size) return undefined;
		const name = Buffer.from(
			await source.readAt(BigInt(namePosition), nameLength),
		);
		const seed = index.readInt32LE(cursor + SEED_FIELD);
		generator.srand(seed);
		decrypt(name, generator);
		const offset = BigInt(index.readUInt32LE(cursor + OFFSET_FIELD));
		const size = BigInt(index.readUInt32LE(cursor + SIZE_FIELD));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(decodeCp932(name)),
				offset,
				size,
				packedSize: size,
				metadata: { seed, generator: kind },
			}),
		);
		namePosition += nameLength;
	}
	return entries;
}

async function readNpf(source: ByteSource): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (header.readInt32LE(0) !== SIGNATURE) return undefined;
	if (header.readInt32LE(4) !== SIGNATURE_VERSION) return undefined;
	if (header.readInt32LE(8) !== SIGNATURE_SUBVERSION) return undefined;
	const candidates: [1 | 2, RandomGenerator][] = [
		[1, new RandomGenerator1()],
		[2, new RandomGenerator2()],
	];
	for (const [kind, generator] of candidates) {
		const entries = await readIndex(source, generator, kind);
		if (entries !== undefined) return entries;
	}
	return undefined;
}

/** GARBro `NpfOpener.OpenEntry`: payloads are exclusive-ored with a keystream of their own seed. */
async function openNpfEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const state = entryState(entry);
	const data = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	if (state === undefined) return Readable.from([data]);
	const generator =
		state.generator === 2 ? new RandomGenerator2() : new RandomGenerator1();
	generator.srand(state.seed);
	decrypt(data, generator);
	// `NpfOpener.OpenImage` hands an entry that opens with the word `IMGX` to the walk of the pictures of
	// this engine, which the raw places of the entry cannot stand for, and everything else to the decoder of
	// the platform. This port reads the pictures of the walk itself and hands every other entry out as it
	// stands.
	if (data.length > 8 && IMGX_SIGNATURE === data.readUInt32LE(0)) {
		const picture = unpackImgx(data);
		if (!picture) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"The places of the picture of this resource stand of no picture of their own",
			);
		}
		return Readable.from([picture]);
	}
	return Readable.from([data]);
}

export const nononoNpfDescriptor: FormatDescriptor = {
	id: "nonono-npf",
	name: "NGS engine resource archive",
	extensions: ["npf"],
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
			source: "ArcFormats/Nonono/ArcNPF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const nononoNpfFormat = defineFixedArchive({
	descriptor: nononoNpfDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("PACK", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readNpf(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const entries = await readNpf(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid NGS archive layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openNpfEntry,
});
