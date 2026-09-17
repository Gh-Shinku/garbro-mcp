// Format reference: GARbro "ArcFormats/Crowd/ImageGAX.cs", classes `GaxFormat` and `GaxTransform` (a
// portable network graphic behind a rolling key the picture's own bytes drive). GARbro commit
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
import { PNG_SIGNATURE, readPngHeaderFields } from "../shared/png.js";

/** The four bytes of the signature word: three clear bytes and one. */
const SIGNATURE = Buffer.from([0x00, 0x00, 0x00, 0x01]);
const KEY_SIZE = 16;
const KEY_OFFSET = 4;
/** The picture begins behind the signature and the key. */
const PIXEL_OFFSET = KEY_OFFSET + KEY_SIZE;
/** The transform works on whole blocks of sixteen bytes. */
const BLOCK_SIZE = 16;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface GaxLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `GaxTransform`: whole blocks of sixteen bytes are turned over by the key, and after every whole block the
 * key steps on, driven by the byte before the last one the block was turned over to. The step itself is told
 * apart by the three low bits of that byte, of which the sixth and seventh kinds share one step. What stands
 * behind the last whole block is turned over by the key as it then stands, from its first byte on, and does
 * not step it on again.
 */
export function decryptGax(data: Buffer, key: Buffer): Buffer {
	if (key.length !== KEY_SIZE) {
		throw new RangeError("Gax key must be sixteen bytes long");
	}
	const output = Buffer.alloc(data.length, 0x00);
	const state = Buffer.from(key);
	let position = 0;
	while (data.length - position >= BLOCK_SIZE) {
		for (let index = 0; index < BLOCK_SIZE; index += 1) {
			output[position + index] =
				(data[position + index] ?? 0) ^ (state[index] ?? 0);
		}
		stepGaxKey(state, output[position + BLOCK_SIZE - 2] ?? 0);
		position += BLOCK_SIZE;
	}
	const remaining = data.length - position;
	for (let index = 0; index < remaining; index += 1) {
		output[position + index] =
			(data[position + index] ?? 0) ^ (state[index] ?? 0);
	}
	return output;
}

/**
 * The seven steps of `GaxTransform`, the sixth of which runs into the seventh as the reference's own `goto`.
 * `driving` is the whole byte the step was told apart by, whose three low bits are the step's number; only
 * the first step uses any more of it.
 */
export function stepGaxKey(key: Buffer, driving: number): void {
	const at = (index: number): number => key[index] ?? 0;
	const set = (index: number, value: number): void => {
		key[index] = value & 0xff;
	};
	switch (driving & 7) {
		case 0:
			set(0, at(0) + driving);
			set(3, at(3) + driving + 2);
			set(4, at(2) + driving + 11);
			set(8, at(6) + 7);
			break;
		case 1:
			set(2, at(9) + at(10));
			set(6, at(7) + at(15));
			set(8, at(8) + at(1));
			set(15, at(3) + at(5));
			break;
		case 2:
			set(1, at(1) + at(2));
			set(5, at(5) + at(6));
			set(7, at(7) + at(8));
			set(10, at(10) + at(11));
			break;
		case 3:
			set(9, at(1) + at(2));
			set(11, at(5) + at(6));
			set(12, at(7) + at(8));
			set(13, at(10) + at(11));
			break;
		case 4:
			set(0, at(1) + 0x6f);
			set(3, at(4) + 0x47);
			set(4, at(5) + 0x11);
			set(14, at(15) + 0x40);
			break;
		case 5:
			set(2, at(2) + at(10));
			set(4, at(5) + at(12));
			set(6, at(8) + at(14));
			set(8, at(0) + at(11));
			break;
		case 6:
			// The sixth kind runs the seventh's step behind its own, as the reference's own `goto case 7`.
			set(9, at(1) + at(11));
			set(11, at(3) + at(13));
			set(13, at(5) + at(15));
			set(15, at(7) + at(9));
			set(1, at(5) + at(9));
			set(2, at(6) + at(10));
			set(3, at(7) + at(11));
			set(4, at(8) + at(12));
			break;
		case 7:
			set(1, at(5) + at(9));
			set(2, at(6) + at(10));
			set(3, at(7) + at(11));
			set(4, at(8) + at(12));
			break;
	}
}

/** `GaxFormat.ReadMetaData`: the picture is read through the reference's own portable network graphic reader. */
export function readGaxLayout(plain: Buffer): GaxLayout | undefined {
	return readPngHeaderFields(plain);
}

async function readStored(source: ByteSource): Promise<Buffer | undefined> {
	if (source.size < BigInt(PIXEL_OFFSET + PNG_SIGNATURE.length))
		return undefined;
	try {
		return Buffer.from(await source.readAt(0n, Number(source.size)));
	} catch {
		return undefined;
	}
}

function decryptedPicture(stored: Buffer): Buffer {
	const key = stored.subarray(KEY_OFFSET, PIXEL_OFFSET);
	return decryptGax(stored.subarray(PIXEL_OFFSET), key);
}

async function readLayout(source: ByteSource): Promise<GaxLayout | undefined> {
	if (source.size < BigInt(PIXEL_OFFSET + 29)) return undefined;
	const stored = await readStored(source);
	if (!stored) return undefined;
	if (!stored.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const plain = decryptedPicture(stored);
	return readGaxLayout(plain);
}

export const crowdGaxImageDescriptor: FormatDescriptor = {
	id: "crowd-gax-image",
	name: "ANIM encrypted image",
	extensions: ["gax"],
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
			source: "ArcFormats/Crowd/ImageGAX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const crowdGaxImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: crowdGaxImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not an ANIM encrypted picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const size = layout.width * layout.height * 4;
		if (!Number.isSafeInteger(size) || size > LIMIT) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`ANIM encrypted picture of ${size} bytes is too large`,
			);
		}
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "png"),
				offset: BigInt(PIXEL_OFFSET),
				size: source.size - BigInt(PIXEL_OFFSET),
				encrypted: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				},
			}),
			// The stored picture is turned over, so its stored length is not the length it hands out.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "png",
				encrypted: true,
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		if (!stored) {
			throw invalidPicture("Not an ANIM encrypted picture");
		}
		const plain = decryptedPicture(stored);
		if (!plain.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
			throw invalidPicture("Not an ANIM encrypted picture");
		}
		return Readable.from([plain]);
	},
});
