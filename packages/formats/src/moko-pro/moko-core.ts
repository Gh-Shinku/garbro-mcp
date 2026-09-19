// Format reference: GARbro "ArcFormats/MokoPro/CompressedFile.cs", class `MokoCrypt`, which the image, the
// audio and the archive shape of the container share. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import type { ByteSource } from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";

/** 'NNNN', the word the reference registers for all three shapes of the container. */
export const MOKO_SIGNATURE = Buffer.from("NNNN", "latin1");
/** The payload begins with the word and the size of what the walk of runs behind gives. */
export const MOKO_HEADER_SIZE = 8;
const UNPACKED_SIZE_FIELD = 4;
/** `MokoCrypt.DefaultKey`. */
const KEY_FIRST = 1;
const KEY_SECOND = 0x23;
/** The walk of runs of this engine stands on a ring of noughts filled with spaces. */
export const MOKO_FRAME_FILL = 0x20;
/** A sound or picture this project is willing to hold, past which the reference would run out of memory. */
export const MOKO_LIMIT = 256 * 1024 * 1024;

/**
 * `MokoCrypt.Decrypt`: a walk from the end of the payload towards its beginning, where every byte is mixed
 * with the byte behind it and the two bytes of the key, and the byte behind it is then mixed with the byte
 * that has just been mixed. The walk stands as it is, so the reference can read it while it reads the file.
 */
export function decryptMoko(input: Buffer): void {
	for (let i = input.length - 2; i >= 0; i -= 1) {
		input[i] = (input[i] ?? 0) ^ (KEY_SECOND ^ (input[i + 1] ?? 0));
		input[i + 1] = (input[i + 1] ?? 0) ^ (KEY_FIRST ^ (input[i] ?? 0));
	}
}

/** The size of what the walk of runs behind the head of the container gives, where the head says so. */
export async function readMokoHeader(
	source: ByteSource,
): Promise<number | undefined> {
	if (source.size < BigInt(MOKO_HEADER_SIZE)) return undefined;
	const header = Buffer.from(await source.readAt(0n, MOKO_HEADER_SIZE));
	if (!header.subarray(0, 4).equals(MOKO_SIGNATURE)) return undefined;
	const unpackedSize = header.readInt32LE(UNPACKED_SIZE_FIELD);
	if (unpackedSize <= 0 || unpackedSize > MOKO_LIMIT) return undefined;
	return unpackedSize;
}

/**
 * `MokoCrypt.UnpackBytes`: everything behind the head of the container is walked over and the walk of runs
 * then gives what the head says.
 */
export function unpackMoko(stored: Buffer, unpackedSize: number): Buffer {
	const payload = Buffer.from(stored.subarray(MOKO_HEADER_SIZE));
	decryptMoko(payload);
	return inflateLzss(payload, {
		outputLength: unpackedSize,
		frameFill: MOKO_FRAME_FILL,
	});
}
