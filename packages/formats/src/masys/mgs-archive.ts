// Format reference: GARbro ArcFormats/Masys/ArcMGS.cs (class `MgsOpener` with its `PcmDecoder`). Its
// payloads are walked with the Abogado `AdpDecoder`, which the reference reaches by name.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { AbogadoAdpDecoder } from "../abogado/adp-audio.js";
import { changeExtension } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { type WavFormat, writeWave } from "../shared/wav.js";
import { decryptName } from "./mgd.js";

const MAGIC = "MGS";
/** The flag word at 3 marks a file whose names are XORed. */
const FLAG_OFFSET = 3;
const COUNT_OFFSET = 0x20;
const INDEX_OFFSET = 0x22;
/** A record is the format byte, nine format bytes, the name, the size and the offset. */
const NAME_SIZE_OFFSET = 9;
const NAME_OFFSET = 10;
const TAIL_SIZE = 8;
const SIZE_OFFSET = 0;
const OFFSET_OFFSET = 4;
const ENCRYPTED_FLAG = 100;
const FORMAT_WAVE = 0;
const FORMAT_MIDI = 1;
/** Set in the channel word, this bit marks a payload the reference decodes itself. */
const PACKED_FLAG = 0x8000;
const CHANNEL_MASK = 0x7fff;
/** The bits per sample the reference reports for a payload it decodes. */
const PACKED_BITS = 0x10;
const PCM_FORMAT_TAG = 1;

/** What `MgsOpener.OpenEntry` needs to know about a wave record. */
export interface MgsSoundPlan {
	/** The stored format byte: 0 wave, 1 midi, anything else an opaque payload. */
	readonly format: number;
	readonly channels?: number;
	readonly sampleRate?: number;
	readonly bitsPerSample?: number;
}

export interface MgsEntryPlan extends MgsSoundPlan {
	readonly index: number;
	readonly name: string;
	readonly offset: bigint;
	readonly size: bigint;
}

/**
 * `MgsOpener.GetExtFromFormatId`, with the removal that `Path.ChangeExtension (name, null)` performs for
 * every other format.
 */
function renameForFormat(name: string, format: number): string {
	if (FORMAT_WAVE === format) return changeExtension(name, "wav");
	if (FORMAT_MIDI === format) return changeExtension(name, "mid");
	return changeExtension(name, "");
}

/** `MgsOpener.TryOpen`: the index is a chain of length prefixed records from 0x22. */
export async function readMgsIndex(
	source: ByteSource,
): Promise<MgsEntryPlan[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (header.toString("latin1", 0, MAGIC.length) !== MAGIC) return undefined;
	const count = header.readInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const encrypted = header.readUInt16LE(FLAG_OFFSET) === ENCRYPTED_FLAG;
	const plans: MgsEntryPlan[] = [];
	let position = BigInt(INDEX_OFFSET);
	for (let index = 0; index < count; index += 1) {
		if (position + BigInt(NAME_OFFSET) > source.size) return undefined;
		const head = await source.readAt(position, NAME_OFFSET);
		const format = head[0] ?? 0;
		const nameSize = head[NAME_SIZE_OFFSET] ?? 0;
		if (0 === nameSize) return undefined;
		if (position + BigInt(NAME_OFFSET + nameSize) > source.size)
			return undefined;
		const nameBytes = Buffer.from(
			await source.readAt(position + BigInt(NAME_OFFSET), nameSize),
		);
		if (encrypted) decryptName(nameBytes);
		const plan: MgsEntryPlan = {
			index,
			name: renameForFormat(decodeCp932(nameBytes), format),
			offset: 0n,
			size: 0n,
			format,
			...(FORMAT_WAVE === format
				? {
						channels: head.readUInt16LE(1),
						sampleRate: head.readUInt32LE(3),
						bitsPerSample: head.readUInt16LE(7),
					}
				: {}),
		};
		position += BigInt(NAME_OFFSET + nameSize);
		if (position + BigInt(TAIL_SIZE) > source.size) return undefined;
		const tail = await source.readAt(position, TAIL_SIZE);
		const size = BigInt(tail.readUInt32LE(SIZE_OFFSET));
		const offset = BigInt(tail.readUInt32LE(OFFSET_OFFSET));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		plans.push({ ...plan, offset, size });
		position += BigInt(TAIL_SIZE);
	}
	return plans;
}

/**
 * `PcmDecoder.Decode`: a chunk opens with one or two seed samples and their quantisers, followed by the
 * packed nibbles. The low nibble of an octet comes first, where the container walk of the Abogado port
 * takes the high one first.
 */
export function decodeMgsSamples(
	payload: Buffer,
	channels: number,
	bytesPerChunk: number,
): Buffer {
	const perChunk =
		1 === channels ? (bytesPerChunk - 4) * 4 + 2 : (bytesPerChunk - 8) * 4 + 4;
	const output = Buffer.alloc(
		Math.trunc(payload.length / bytesPerChunk) * perChunk,
	);
	let at = 0;
	let written = 0;
	const need = (count: number): void => {
		if (at + count > payload.length)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Masys packed sound ends inside a chunk",
			);
	};
	const put = (sample: number): void => {
		if (written + 2 > output.length)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Masys packed sound outgrew its chunks",
			);
		output.writeInt16LE(sample, written);
		written += 2;
	};
	if (1 === channels) {
		const decoder = new AbogadoAdpDecoder();
		while (at < payload.length) {
			need(4);
			const sample = payload.readInt16LE(at);
			put(sample);
			decoder.reset(sample, payload.readUInt16LE(at + 2) & 0xff);
			at += 4;
			for (let i = 0; i < bytesPerChunk - 4; i += 1) {
				need(1);
				const octet = payload.readUInt8(at);
				at += 1;
				put(decoder.decode(octet));
				put(decoder.decode(octet >> 4));
			}
		}
		return output.subarray(0, written);
	}
	const first = new AbogadoAdpDecoder();
	const second = new AbogadoAdpDecoder();
	const samplesPerChunk = Math.trunc((bytesPerChunk - 8) / 8);
	while (at < payload.length) {
		need(8);
		let sample = payload.readInt16LE(at);
		put(sample);
		first.reset(sample, payload.readUInt16LE(at + 2) & 0xff);
		sample = payload.readInt16LE(at + 4);
		put(sample);
		second.reset(sample, payload.readUInt16LE(at + 6) & 0xff);
		at += 8;
		for (let i = 0; i < samplesPerChunk; i += 1) {
			need(8);
			let firstCode = payload.readUInt32LE(at);
			let secondCode = payload.readUInt32LE(at + 4);
			at += 8;
			for (let code = 0; code < 8; code += 1) {
				put(first.decode(firstCode & 0xff));
				put(second.decode(secondCode & 0xff));
				firstCode >>>= 4;
				secondCode >>>= 4;
			}
		}
	}
	return output.subarray(0, written);
}

/** `MgsOpener.OpenEntry`: wave entries get a RIFF header, and a packed wave is decoded first. */
export function unpackMgsEntry(payload: Buffer, plan: MgsSoundPlan): Buffer {
	if (FORMAT_WAVE !== plan.format) return payload;
	const stored = plan.channels ?? 0;
	const channels = stored & CHANNEL_MASK;
	const packed = 0 !== (stored & PACKED_FLAG);
	const format: WavFormat = {
		formatTag: PCM_FORMAT_TAG,
		channels,
		sampleRate: plan.sampleRate ?? 0,
		averageBytesPerSecond: 0,
		blockAlign: 0,
		bitsPerSample: packed ? PACKED_BITS : (plan.bitsPerSample ?? 0),
	};
	format.blockAlign = Math.trunc((channels * format.bitsPerSample) / 8);
	format.averageBytesPerSecond = format.sampleRate * format.blockAlign;
	const pcm = packed
		? decodeMgsSamples(payload, channels, plan.bitsPerSample ?? 0)
		: payload;
	return writeWave(format, pcm);
}

export const mgsDescriptor: FormatDescriptor = {
	id: "masys-mgs",
	name: "Masys audio resources archive",
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
			source: "ArcFormats/Masys/ArcMGS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mgsFormat = defineFixedArchive({
	descriptor: mgsDescriptor,
	detection: { signatures: [{ bytes: Buffer.from(MAGIC, "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readMgsIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const plans = await readMgsIndex(source);
		if (!plans)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Masys MGS layout");
		const entries: FixedEntry[] = plans.map((plan) =>
			createFixedEntry({
				id: plan.index,
				...normalizeEntryPath(plan.name),
				offset: plan.offset,
				size: plan.size,
				encrypted: false,
				metadata: {
					format: plan.format,
					...(FORMAT_WAVE === plan.format
						? {
								channels: plan.channels,
								sampleRate: plan.sampleRate,
								bitsPerSample: plan.bitsPerSample,
							}
						: {}),
				},
			}),
		);
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source, entry) {
		// The record's format fields travel through the entry metadata, so no second index walk is needed.
		const stored = entry.metadata ?? {};
		const plan: MgsSoundPlan = {
			format: typeof stored.format === "number" ? stored.format : FORMAT_WAVE,
			...(typeof stored.channels === "number"
				? { channels: stored.channels }
				: {}),
			...(typeof stored.sampleRate === "number"
				? { sampleRate: stored.sampleRate }
				: {}),
			...(typeof stored.bitsPerSample === "number"
				? { bitsPerSample: stored.bitsPerSample }
				: {}),
		};
		const payload = await source.readAt(entry.offset, Number(entry.size));
		return Readable.from([unpackMgsEntry(payload, plan)]);
	},
});
