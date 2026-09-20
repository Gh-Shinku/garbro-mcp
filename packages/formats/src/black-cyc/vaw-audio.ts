import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 0x40;
const PACK_TYPE_FIELD = 0x30;
const PACK_TYPE_SIZE = 0x10;
const PACK_TYPE = /^PACKTYPE=(\d+)(A?) +$/;
const PLAIN_WAVE = 0;
const OWN_WALK = 1;
const OGG_SOUND = 2;
const OGG_SOUND_BEHIND = 6;
const RIFF_WORD = Buffer.from("RIFF", "latin1");
const OGG_WORD = Buffer.from("OGG ", "latin1");
const OGG_WORD_FIELD = 0x10;
const PLAIN_WAVE_OFFSET = 0x40;
const OGG_SOUND_OFFSET = 0x6c;
const OGG_BEHIND_OFFSET = 0x40;
/** The walk of places of a sound of its own: the wave header of the sound stands in the four and twenty places
 * behind the head, and how many places its own head stands in stands four places into it. */
const WAVE_HEAD_FIELD = 0x40;
const WAVE_HEAD_SIZE = 0x14;
const WAVE_SIZE_FIELD = 0x04;
const FORMAT_SIZE_FIELD = 0x10;
const WAVE_SIZE_ADD = 8;
const BYTES_PER_SAMPLE = 2;
/** How many places a step of the walk of places stands, and how many of them stand behind the first. */
const COUNT_BITS = 4;
const PLACE_SIGN = 0x4000;
const PLACE_SHIFT = 15;
const SIGN_PLACE = 31;

export interface VawHeader {
	packType: number;
	hasOwnPlaces: boolean;
}

export interface VawSound {
	kind: number;
	offset: number;
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export function readVawHeader(
	data: Buffer,
	fileLength = data.length,
): VawHeader | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (fileLength < HEADER_SIZE) return undefined;
	const words = data.toString(
		"latin1",
		PACK_TYPE_FIELD,
		PACK_TYPE_FIELD + PACK_TYPE_SIZE,
	);
	const match = PACK_TYPE.exec(words);
	if (!match) return undefined;
	const packType = Number.parseInt(match[1] ?? "", 10);
	if (!Number.isSafeInteger(packType)) return undefined;
	return { packType, hasOwnPlaces: (match[2] ?? "").length > 0 };
}

export function readVawSound(
	data: Buffer,
	header: VawHeader,
	fileLength = data.length,
): VawSound | undefined {
	if (PLAIN_WAVE === header.packType) {
		if (PLAIN_WAVE_OFFSET + RIFF_WORD.length > fileLength) return undefined;
		if (
			!data.subarray(PLAIN_WAVE_OFFSET, PLAIN_WAVE_OFFSET + 4).equals(RIFF_WORD)
		) {
			return undefined;
		}
		return { kind: PLAIN_WAVE, offset: PLAIN_WAVE_OFFSET };
	}
	if (OWN_WALK === header.packType) {
		if (WAVE_HEAD_FIELD + WAVE_HEAD_SIZE > fileLength) return undefined;
		return { kind: OWN_WALK, offset: WAVE_HEAD_FIELD };
	}
	if (OGG_SOUND === header.packType) {
		if (OGG_SOUND_OFFSET >= fileLength) return undefined;
		return { kind: OGG_SOUND, offset: OGG_SOUND_OFFSET };
	}
	if (OGG_SOUND_BEHIND === header.packType) {
		if (OGG_WORD_FIELD + OGG_WORD.length > fileLength) return undefined;
		if (
			!data
				.subarray(OGG_WORD_FIELD, OGG_WORD_FIELD + OGG_WORD.length)
				.equals(OGG_WORD)
		) {
			return undefined;
		}
		if (OGG_BEHIND_OFFSET >= fileLength) return undefined;
		return { kind: OGG_SOUND_BEHIND, offset: OGG_BEHIND_OFFSET };
	}
	return undefined;
}

export function decodeVaw(
	data: Buffer,
	at: number,
	fileLength = data.length,
): Buffer {
	if (at + WAVE_HEAD_SIZE > fileLength) {
		throw invalidSound("VAW sound is cut short of its own head");
	}
	const head = Buffer.from(data.subarray(at, at + WAVE_HEAD_SIZE));
	const formatSize = head.readInt32LE(FORMAT_SIZE_FIELD);
	if (formatSize < 0 || at + WAVE_HEAD_SIZE + formatSize > fileLength) {
		throw invalidSound("VAW sound is cut short of its own head");
	}
	const waveHead = Buffer.from(
		data.subarray(at, at + WAVE_HEAD_SIZE + formatSize),
	);
	const waveSize = head.readInt32LE(WAVE_SIZE_FIELD) + WAVE_SIZE_ADD;
	const dataSize = waveSize - waveHead.length;
	if (dataSize < 0) {
		throw invalidSound("VAW sound names no places of its own");
	}
	const places = Math.floor(dataSize / BYTES_PER_SAMPLE);
	const pcm: Buffer = Buffer.alloc(places * BYTES_PER_SAMPLE, 0x00);
	const bits = new LsbBitReader(data, at + waveHead.length);
	let sample = 0;
	for (let place = 0; place < places; place += 1) {
		let count = bits.readBits(COUNT_BITS);
		if (-1 === count) count = 0;
		let code = 0;
		if (count > 0) code = shl(bits.readBits(count), 32 - count);
		code >>= 32 - count;
		const sign = code >> SIGN_PLACE;
		code ^= PLACE_SIGN >> (PLACE_SHIFT - count);
		code -= sign;
		sample = (sample + code) & 0xffff;
		pcm.writeInt16LE(sample > 0x7fff ? sample - 0x10000 : sample, place * 2);
	}
	return Buffer.concat([waveHead, pcm]);
}

function shl(value: number, places: number): number {
	if (places >= 32) return 0;
	return (value << places) | 0;
}

/** The walk of places of a sound of its own stands under a walk of the least place first, which the reference
 * reads one place of a byte at a time. */
class LsbBitReader {
	readonly #data: Buffer;
	#at: number;
	#bits = 0;
	#count = 0;

	constructor(data: Buffer, at: number) {
		this.#data = data;
		this.#at = at;
	}

	/** Returns `-1` where the file ends before the places asked for stand in it. */
	readBits(count: number): number {
		if (this.#count >= count) {
			const mask = (1 << count) - 1;
			const value = this.#bits & mask;
			this.#bits >>>= count;
			this.#count -= count;
			return value;
		}
		let value = this.#bits & ((1 << this.#count) - 1);
		let left = count - this.#count;
		let shift = this.#count;
		this.#count = 0;
		while (left >= 8) {
			if (this.#at >= this.#data.length) return -1;
			value |= (this.#data[this.#at] ?? 0) << shift;
			this.#at += 1;
			shift += 8;
			left -= 8;
		}
		if (left > 0) {
			if (this.#at >= this.#data.length) return -1;
			const byte = this.#data[this.#at] ?? 0;
			value |= (byte & ((1 << left) - 1)) << shift;
			this.#bits = byte >>> left;
			this.#count = 8 - left;
			this.#at += 1;
		}
		return value;
	}
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readVaw(source: ByteSource) {
	const stored = await readStored(source);
	const header = readVawHeader(stored, Number(source.size));
	if (!header) throw invalidSound("Not a VAW sound");
	const sound = readVawSound(stored, header, Number(source.size));
	if (!sound)
		throw invalidSound("VAW sound names no places this project reads");
	return { stored, layout: { header, sound } };
}

export const blackCycVawAudioDescriptor: FormatDescriptor = {
	id: "black-cyc-vaw-audio",
	name: "Black Cyc audio format",
	extensions: ["vaw", "wgq"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/BlackCyc/AudioVAW.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const blackCycVawAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: blackCycVawAudioDescriptor,
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		void sourcePath;
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const stored = await readStored(source);
			const header = readVawHeader(stored, Number(source.size));
			if (!header) return false;
			return readVawSound(stored, header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const { layout } = await readVaw(source);
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const sound = layout.sound.kind !== OWN_WALK;
		const entry = createFixedEntry({
			id: 0,
			path: changeExtension(fileName, sound ? "ogg" : "wav"),
			offset: BigInt(layout.sound.offset),
			size: source.size - BigInt(layout.sound.offset),
			compressed: true,
			metadata: { type: "audio" } as Record<string, unknown>,
		});
		return {
			entries: [entry],
			metadata: {
				audio: sound ? "ogg" : "wav",
				packType: layout.header.packType,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const { stored, layout } = await readVaw(source);
		// A sound of the kinds that stand as a wave hands out the wave it stands as, and a sound of the kinds
		// that stand as a sound of their own hands out the places behind the head.
		if (OWN_WALK !== layout.sound.kind) {
			return Readable.from([Buffer.from(stored.subarray(layout.sound.offset))]);
		}
		return Readable.from([
			decodeVaw(stored, layout.sound.offset, stored.length),
		]);
	},
});
