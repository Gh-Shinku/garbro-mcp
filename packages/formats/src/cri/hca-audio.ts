// The sound of the Cri engine (`HCA`), of the reference `ArcFormats/Cri/AudioHCA.cs` (`HcaAudio`,
// `HcaInput`, `HcaReader`). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// A sound of the engine stands of a head of chunks behind the word `HCA`: the word of the version, the place
// the frames of the sound stand at, and the counts of the walk of the sound (`fmt`, `comp`, `loop`, `ciph`,
// `rva`, `ath`). This port reads that head and the counts of the places of the walk of it, which is what the
// reference reads before it stands of the frames of the sound (`HcaReader.DecodeBlock` and the walk of the
// counts of the places of a picture of the engine behind it) - those frames stand unported here.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import type { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	HCA_DEFAULT_KEY,
	createHcaCipher,
	readHcaAthTable,
} from "./hca-core.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'HCA', the word every sound of the engine begins with. */
const SIGNATURE = 0x48434100;
const SIGNATURE_BYTES = Buffer.from("HCA\0", "latin1");
/**
 * The reference reads every word of the head through `ReadSignature`, which clears the high bit of every
 * byte, so a head whose bytes have that bit set stands of the same counts as one that does not: the word
 * stands as a signature here only for the common case of it, where the bit stands clear.
 */
const SIGNATURE_MASK = 0x7f7f7f7f;
const CHUNK_FMT = 0x666d7400;
const CHUNK_COMP = 0x636f6d70;
const CHUNK_LOOP = 0x6c6f6f70;
const CHUNK_CIPH = 0x63697068;
const CHUNK_RVA = 0x72766100;
const CHUNK_ATH = 0x61746800;
const HEAD_SIZE = 8;
const CHANNEL_LIMIT = 16;
const BLOCK_SIZE_MIN = 8;
const R_COUNT = 8;
const COMP_TAIL_SIZE = 2;
const LOOP_SIZE = 12;
/** The count of the places of a block of the walk of the engine (`0x80` places of eight counts). */
const BLOCK_SAMPLES = 0x80;
const BLOCK_COUNT_PER_FRAME = 8;

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** The counts of the walk of the sound of the engine, as the head of it gives them. */
export interface HcaLayout {
	version: number;
	dataOffset: number;
	channels: number;
	sampleRate: number;
	blockCount: number;
	blockSize: number;
	/** The counts of the walk of the places of a block of the engine (`CompParams.R`). */
	r: number[];
	/** The count of the places of the counts of a block, as the reference works it (`CompParams.R9`). */
	r9: number;
	cipherType: number;
	athType: number;
	rvaVolume: number;
	/** The counts of the channels of the sound, as the reference stands of them (`InitChannels`). */
	channelMap: number[];
}

/** A reader of words of the head of a sound of the engine, which stands of no place behind its end. */
class HeadReader {
	#data: Buffer;
	#at = 0;

	constructor(data: Buffer) {
		this.#data = data;
	}

	get position(): number {
		return this.#at;
	}

	readU8(): number | undefined {
		if (this.#at + 1 > this.#data.length) return undefined;
		const value = this.#data[this.#at] ?? 0;
		this.#at += 1;
		return value;
	}

	readU16(): number | undefined {
		if (this.#at + 2 > this.#data.length) return undefined;
		const value = this.#data.readUInt16BE(this.#at);
		this.#at += 2;
		return value;
	}

	readU32(): number | undefined {
		if (this.#at + 4 > this.#data.length) return undefined;
		const value = this.#data.readUInt32BE(this.#at);
		this.#at += 4;
		return value;
	}

	readSingle(): number | undefined {
		if (this.#at + 4 > this.#data.length) return undefined;
		const value = this.#data.readFloatBE(this.#at);
		this.#at += 4;
		return value;
	}

	readBytes(count: number): number[] | undefined {
		if (this.#at + count > this.#data.length) return undefined;
		const value = [...this.#data.subarray(this.#at, this.#at + count)];
		this.#at += count;
		return value;
	}

	skip(count: number): boolean {
		if (this.#at + count > this.#data.length) return false;
		this.#at += count;
		return true;
	}
}

/**
 * The counts of the channels of a sound of the engine: the reference `HcaReader.InitChannels`, which names
 * the places of the channels that stand of the counts of the places of a block of the walk of the engine.
 */
export function hcaChannelMap(
	channels: number,
	r: readonly number[],
): number[] | undefined {
	const map: number[] = new Array(channels).fill(0);
	const group = r[2] ?? 0;
	if (group <= 0 || channels % group !== 0) return undefined;
	const step = channels / group;
	if (0 !== (r[6] ?? 0) && step > 1) {
		let at = 0;
		for (let groupIndex = 0; groupIndex < group; groupIndex += 1, at += step) {
			switch (step) {
				case 2:
				case 3:
					map[at] = 1;
					map[at + 1] = 2;
					break;
				case 4:
					if (0 === (r[3] ?? 0)) {
						map[at + 2] = 1;
						map[at + 3] = 2;
					}
					map[at] = 1;
					map[at + 1] = 2;
					break;
				case 5:
					if ((r[3] ?? 0) <= 2) {
						map[at + 3] = 1;
						map[at + 4] = 2;
					}
					map[at] = 1;
					map[at + 1] = 2;
					break;
				case 6:
				case 7:
					map[at + 4] = 1;
					map[at + 5] = 2;
					map[at] = 1;
					map[at + 1] = 2;
					break;
				case 8:
					map[at + 6] = 1;
					map[at + 7] = 2;
					map[at + 4] = 1;
					map[at + 5] = 2;
					map[at] = 1;
					map[at + 1] = 2;
					break;
				default:
					break;
			}
		}
	}
	return map;
}

/** Reads the head of a sound of the engine, where the head of one stands at the start of `data`. */
export function readHcaHeader(data: Buffer): HcaLayout | undefined {
	const reader = new HeadReader(data);
	const signature = reader.readU32();
	if (undefined === signature || SIGNATURE !== (signature & SIGNATURE_MASK))
		return undefined;
	const version = reader.readU16();
	const dataOffset = reader.readU16();
	if (undefined === version || undefined === dataOffset) return undefined;

	let channels: number | undefined;
	let sampleRate = 0;
	let blockCount: number | undefined;
	let blockSize: number | undefined;
	let r: number[] = new Array(R_COUNT).fill(0);
	let cipherType: number | undefined;
	let athType: number | undefined;
	let rvaVolume = 1;

	// The walk of the counts of the head is a walk of the counts of a fixed size: the reference names no
	// size of a count at all, so a count it does not know ends the walk and leaves the rest of the head.
	while (reader.position < dataOffset) {
		const chunk = reader.readU32();
		if (undefined === chunk) return undefined;
		switch (chunk & SIGNATURE_MASK) {
			case CHUNK_FMT: {
				const format = reader.readU32();
				const count = reader.readU32();
				if (undefined === format || undefined === count) return undefined;
				channels = (format >>> 24) & 0xff;
				sampleRate = format & 0xffffff;
				blockCount = count;
				if (!reader.skip(4)) return undefined;
				continue;
			}
			case CHUNK_COMP: {
				const size = reader.readU16();
				const counts = reader.readBytes(R_COUNT);
				if (undefined === size || undefined === counts) return undefined;
				blockSize = size;
				r = counts;
				if (!reader.skip(COMP_TAIL_SIZE)) return undefined;
				continue;
			}
			case CHUNK_LOOP:
				if (!reader.skip(LOOP_SIZE)) return undefined;
				continue;
			case CHUNK_CIPH: {
				const type = reader.readU16();
				if (undefined === type) return undefined;
				cipherType = type;
				continue;
			}
			case CHUNK_RVA: {
				const volume = reader.readSingle();
				if (undefined === volume) return undefined;
				rvaVolume = volume;
				continue;
			}
			case CHUNK_ATH: {
				const type = reader.readU16();
				if (undefined === type) return undefined;
				athType = type;
				continue;
			}
			default:
				break;
		}
		break;
	}

	if (undefined === blockCount || undefined === blockSize) return undefined;
	if (undefined === channels || 0 === channels || channels > CHANNEL_LIMIT)
		return undefined;
	if (blockSize < BLOCK_SIZE_MIN) return undefined;
	if (dataOffset < HEAD_SIZE || dataOffset > data.length) return undefined;

	// The reference works the count of the places of the counts of a block with a division that stands of no
	// place behind zero, which C# stands of toward zero, and a count of one more place wherever a remainder
	// stands: for a count of the places of the counts behind zero the remainder stands behind zero as well,
	// so the reference adds a place of a count where the count of the places of the blocks does not divide
	// the count of the places of them.
	const counts = r;
	const division = counts[7] ?? 0;
	let r9 = 0;
	if (division > 0) {
		const rest = (counts[4] ?? 0) - ((counts[5] ?? 0) + (counts[6] ?? 0));
		r9 = Math.trunc(rest / division) + (rest % division !== 0 ? 1 : 0);
	}
	if (0 === (counts[2] ?? 0)) counts[2] = 1;
	const channelMap = hcaChannelMap(channels, counts);
	if (!channelMap) return undefined;

	return {
		version,
		dataOffset,
		channels,
		sampleRate,
		blockCount,
		blockSize,
		r: counts,
		r9,
		cipherType: cipherType ?? 0,
		athType: athType ?? (version < 0x200 ? 1 : 0),
		rvaVolume,
		channelMap,
	};
}

/**
 * The counts of the walk of a sound of the engine the reference stands of before it walks the frames of it:
 * the head of the sound, the table of the counts of the places of it and the cipher of it.
 */
export function readHcaSound(
	data: Buffer,
	key: readonly [number, number] = HCA_DEFAULT_KEY,
): { layout: HcaLayout; ath: Uint8Array; cipher: Uint8Array } | undefined {
	const layout = readHcaHeader(data);
	if (!layout) return undefined;
	// The reference stands of the counts of the table of the places of a sound of the engine of the counts
	// of the places of the sound itself and of the cipher of it of the counts of the key of the engine: the
	// walk of the engine of this port stands of the counts of the key of the reference (`DefaultKey`), which
	// stands of the counts of the engine of the cipher of the kind of the key of the game unported.
	const ath = readHcaAthTable(layout.athType, layout.sampleRate);
	if (!ath) return undefined;
	const cipher = createHcaCipher(layout.cipherType, key[0], key[1]);
	return { layout, ath, cipher };
}

export const criHcaAudioDescriptor: FormatDescriptor = {
	id: "cri-hca-audio",
	name: "Cri HCA audio",
	extensions: [],
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
			source: "ArcFormats/Cri/AudioHCA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const criHcaAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: criHcaAudioDescriptor,
	// The word of a sound of the engine stands of the low bits of its four bytes, which the reference clears
	// before it stands of them, so the word stands as a signature here only for the common places of it and
	// the walk of the head stands of the sound of every kind.
	detection: {
		signatures: [{ bytes: SIGNATURE_BYTES }],
		priority: -1,
		extensionFallback: true,
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readHcaSound(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const sound = readHcaSound(await readStored(source));
		if (!sound) throw invalidSound("Not a sound of the Cri engine");
		const layout = sound.layout;
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(layout.dataOffset),
				size: source.size - BigInt(layout.dataOffset),
				compressed: true,
				metadata: {
					type: "audio",
					sampleRate: layout.sampleRate,
					channels: layout.channels,
					bitsPerSample: 16,
					samples: layout.blockCount * BLOCK_SAMPLES * BLOCK_COUNT_PER_FRAME,
					frames: layout.blockCount,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				compression: "hca",
				sampleRate: layout.sampleRate,
				channels: layout.channels,
				frames: layout.blockCount,
				blockSize: layout.blockSize,
				version: layout.version,
				cipherType: layout.cipherType,
				athType: layout.athType,
				// The counts of the walk of the engine of the cipher of the sound stand of the counts of the
				// places of the sound itself where the cipher stands of no counts of it at all.
				encrypted: 0 !== layout.cipherType,
			},
		};
	},
	async openEntry(source: ByteSource): Promise<Readable> {
		// The counts of the table of the places of the sound of the engine and the cipher of it stand of the
		// counts of the walk of the engine of the head of the sound itself, which the reference reads before
		// it stands of the frames of it.
		const sound = readHcaSound(await readStored(source));
		if (!sound) throw invalidSound("Not a sound of the Cri engine");
		// The frames of a sound of the engine stand of the walks of the counts of a picture of it (the tables
		// of the counts of the walk of a picture, the places of the counts of a block and the picture of the
		// counts of the places of it), which this port has not taken.
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			"The frames of a sound of the Cri engine stand unported",
		);
	},
});
