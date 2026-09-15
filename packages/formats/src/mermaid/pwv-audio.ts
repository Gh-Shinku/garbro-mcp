// Format reference: GARbro "Legacy/Mermaid/AudioPWV.cs", class `PwvAudio` (Mermaid compressed audio).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** The word the reference registers the format under: a NUL and then `RIF`, the wave it holds shifted by one. */
const SIGNATURE: Buffer = Buffer.from([0x00, 0x52, 0x49, 0x46]);
/** `WAVE` sits four bytes on from where a wave of its own would keep it, behind the NUL. */
const WAVE_OFFSET = 9;
const WAVE: Buffer = Buffer.from("WAVE", "ascii");
const HEADER_SIZE = 0x10;
/** The reference reads this format only from a name of its own. */
const EXTENSION = "pwv";
/** One opcode writes a whole block of this many bytes. */
const BLOCK_SIZE = 16;
const MAXIMUM_OUTPUT_BYTES = 256 * 1024 * 1024;

function hasExtension(sourcePath: string, extension: string): boolean {
	const name = sourcePath.replace(/^.*[/\\]/, "");
	const dot = name.lastIndexOf(".");
	return dot >= 0 && name.slice(dot + 1).toLowerCase() === extension;
}

/**
 * `PwvAudio.TryOpen`: the file opens with a NUL and then with a wave, whose own word sits four bytes further
 * on than it does in a wave that stands on its own. Nothing else of the stream is looked at here; the
 * reference unpacks it whole while opening, which this port leaves to the read.
 */
export function hasPwvHeader(data: Buffer): boolean {
	if (data.length < HEADER_SIZE) return false;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return false;
	return data.subarray(WAVE_OFFSET, WAVE_OFFSET + WAVE.length).equals(WAVE);
}

function invalidAudio(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `PwvAudio.Unpack`: the stream is a wave that has been widened, or narrowed, a block at a time. An opcode
 * of nothing copies the sixteen bytes behind it; one of `1` or `8` takes eight bytes and puts a byte of
 * nothing, or of ones, behind each of them; one of `15` takes the length of a block and then that many bytes.
 *
 * Two quirks are kept. A block that the stream cannot fill is written from the block of the op before it, so a
 * short stream repeats what was read last rather than failing, and a block longer than sixteen bytes hands the
 * reader a fresh block of nothing, losing what it held. An opcode this format does not know is refused, unless
 * the stream has already ended behind it, in which case it is simply the last byte of the file.
 */
export function unpackPwv(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	let block: Buffer = Buffer.alloc(BLOCK_SIZE, 0x00);
	let position = 0;
	let total = 0;
	const byte = (): number => {
		if (position >= data.length) {
			throw invalidAudio("Unexpected end of Mermaid audio");
		}
		position += 1;
		return data[position - 1] ?? 0;
	};
	for (;;) {
		if (position >= data.length) break;
		const control = byte();
		if (0 === control) {
			const count = Math.min(BLOCK_SIZE, data.length - position);
			data.copy(block, 0, position, position + count);
			position += count;
			parts.push(Buffer.from(block.subarray(0, BLOCK_SIZE)));
		} else if (1 === control || 8 === control) {
			const high = 1 === control ? 0x00 : 0xff;
			for (let i = 0; i < BLOCK_SIZE; i += 2) {
				block[i] = byte();
				block[i + 1] = high;
			}
			parts.push(Buffer.from(block.subarray(0, BLOCK_SIZE)));
		} else if (15 === control) {
			const count = byte();
			// A block of more than sixteen bytes is a fresh one, so whatever the one before it held is lost.
			if (count > block.length) block = Buffer.alloc(count, 0x00);
			const got = Math.min(count, data.length - position);
			data.copy(block, 0, position, position + got);
			position += got;
			parts.push(Buffer.from(block.subarray(0, count)));
		} else if (position < data.length) {
			throw invalidAudio(`Unknown Mermaid opcode ${control}`);
		}
		total += parts[parts.length - 1]?.length ?? 0;
		if (total > MAXIMUM_OUTPUT_BYTES) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`Mermaid audio of more than ${MAXIMUM_OUTPUT_BYTES} bytes`,
			);
		}
	}
	return Buffer.concat(parts);
}

export const mermaidPwvAudioDescriptor: FormatDescriptor = {
	id: "mermaid-pwv-audio",
	name: "Mermaid compressed audio",
	extensions: [EXTENSION],
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
			source: "Legacy/Mermaid/AudioPWV.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const mermaidPwvAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mermaidPwvAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (!hasExtension(sourcePath, EXTENSION)) return false;
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return hasPwvHeader(await readStored(source));
	},
	async read(source: ByteSource, sourcePath: string) {
		if (!hasExtension(sourcePath, EXTENSION)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Not a Mermaid compressed audio resource",
			);
		}
		const stored = await readStored(source);
		if (!hasPwvHeader(stored)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Not a Mermaid compressed audio resource",
			);
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "wav"),
						offset: 0n,
						size: source.size,
						compressed: true,
						metadata: { type: "audio" } as Record<string, unknown>,
					}),
					// The wave behind the stream is longer than the stream itself.
					sizeKnown: false,
				},
			],
			metadata: { audio: "wav" },
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		if (!hasPwvHeader(stored)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Not a Mermaid compressed audio resource",
			);
		}
		return Readable.from([unpackPwv(stored)]);
	},
});
