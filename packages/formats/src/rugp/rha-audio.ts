// Format reference: GARbro "ArcFormats/rUGP/AudioRHA.cs", class `RhaAudio` (an rUGP engine sound: the places
// of an MPEG Layer 3 sound stand behind heads of the engine's own, which stand whole in the stream and name
// how many places of a colour of the sound do not). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEAD_SIZE = 2;
/** The places of a sound of its own stand behind a head of the engine's, and how many places of a colour stand
 * in the last places of a step of it stands in the words behind such a head. */
const PLAIN_SCHEMA_MASK = 0x10f;
const PLAIN_SCHEMA = 0x04;
const OWN_SCHEMA = 0x10b;
const LAST_ZERO_ADD = 0x1000;
const LAST_FULL_ADD = 0x2000;
const FULL_ADD_VALUE = 0xff;
const PLAIN_HEAD = 0xfffb0000;
/** The place of a head that names whether the step behind it carries places of a colour of its own. */
const CRC_BIT = 1 << 16;
/** The places of a colour a step of a sound stands as, by how fast the sound runs and the run of places that
 * is one of the three the head names. */
const BIT_RATES = [
	[0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
	[0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
];
/** How fast a sound runs, by the run of places that is one of the three the head names. */
const SOUND_FREQUENCIES = [
	44100, 48000, 32000, 22050, 24000, 16000, 11025, 12000, 8000,
];
/** The places of a colour a step of a sound stands as, which stands in the place of it that names them. */
const BIT_RATE_PLACES = 144000;

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export function rhaToMp3Header(header: number): number {
	return (
		(((header & 0x0f) << 4) |
			((header & 0x07f0) << 5) |
			((header & 0x0800) << 8) |
			0xfff30004) >>>
		0
	);
}

export function mp3FrameLength(header: number): number {
	let lsf: number;
	let frequency: number;
	if (0 === (header & (1 << 20))) {
		lsf = 1;
		frequency = ((header >>> 10) & 3) + 6;
	} else {
		lsf = ~(header >>> 19) & 1;
		frequency = ((header >>> 10) & 3) + lsf * 3;
	}
	const bitRateIndex = (header >>> 12) & 0x0f;
	if (0 === bitRateIndex || 0x0f === bitRateIndex) return 0;
	const padding = (header >>> 9) & 1;
	let frameLength =
		((BIT_RATES[lsf]?.[bitRateIndex] ?? 0) * BIT_RATE_PLACES) /
		((SOUND_FREQUENCIES[frequency] ?? 0) << lsf);
	frameLength = Math.trunc(frameLength);
	frameLength += padding - 4;
	return frameLength;
}

export function readRhaSchema(
	data: Buffer,
	fileLength = data.length,
): number | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	const schema = data.readUInt16BE(0);
	if (PLAIN_SCHEMA === (schema & PLAIN_SCHEMA_MASK)) return 0;
	if (OWN_SCHEMA === schema) return OWN_SCHEMA;
	return undefined;
}

export function convertRhaToMp3(
	data: Buffer,
	fileLength = data.length,
): Buffer | undefined {
	const schema = readRhaSchema(data, fileLength);
	if (undefined === schema) return undefined;
	const plain = 0 === schema;
	let at = plain ? 0 : HEAD_SIZE;
	const steps: Buffer[] = [];
	while (at < fileLength) {
		if (at + HEAD_SIZE > fileLength) {
			throw invalidSound("RHA sound is cut short of the head of a step");
		}
		const rhaHeader = data.readUInt16BE(at);
		at += HEAD_SIZE;
		let addLength = 0;
		let addValue = 0;
		let header: number;
		if (plain) {
			header = (PLAIN_HEAD | rhaHeader) >>> 0;
		} else {
			if (0 !== (rhaHeader & LAST_ZERO_ADD)) {
				if (at + 2 > fileLength) {
					throw invalidSound(
						"RHA sound is cut short of the places behind a head",
					);
				}
				addLength = data.readUInt16LE(at);
				at += 2;
				addValue = 0;
			} else if (0 !== (rhaHeader & LAST_FULL_ADD)) {
				if (at + 2 > fileLength) {
					throw invalidSound(
						"RHA sound is cut short of the places behind a head",
					);
				}
				addLength = data.readUInt16LE(at);
				at += 2;
				addValue = FULL_ADD_VALUE;
			}
			header = rhaToMp3Header(rhaHeader);
		}
		const frameLength = mp3FrameLength(header);
		if (0 === frameLength || addLength > frameLength) return undefined;
		const readLength = frameLength - addLength;
		if (at + readLength > fileLength) break;
		const head = Buffer.alloc(4, 0x00);
		head.writeUInt32BE(header >>> 0, 0);
		const body = Buffer.alloc(frameLength, addValue);
		data.copy(body, 0, at, at + readLength);
		at += readLength;
		steps.push(head, body);
		if (0 === (header & CRC_BIT)) {
			if (at + 2 > fileLength) {
				throw invalidSound(
					"RHA sound is cut short of the places of a colour of a step",
				);
			}
			steps.push(data.subarray(at, at + 2));
			at += 2;
		}
	}
	if (0 === steps.length) return undefined;
	return Buffer.concat(steps);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const rugpRhaAudioDescriptor: FormatDescriptor = {
	id: "rugp-rha-audio",
	name: "rUGP engine compressed audio",
	extensions: [],
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
			source: "ArcFormats/rUGP/AudioRHA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function readConverted(data: Buffer, fileLength: number): Buffer {
	const converted = convertRhaToMp3(data, fileLength);
	if (!converted) throw invalidSound("Not an rUGP engine sound");
	return converted;
}

export const rugpRhaAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: rugpRhaAudioDescriptor,
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
			// The reference claims a file only where its places can stand as a sound of their own.
			return convertRhaToMp3(stored, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const converted = readConverted(stored, Number(source.size));
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "mp3"),
			offset: 0n,
			size: BigInt(converted.length),
			compressed: true,
			metadata: { type: "audio" },
		});
		return { entries: [entry], metadata: { audio: "mp3" } };
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		return Readable.from([readConverted(stored, Number(source.size))]);
	},
});
