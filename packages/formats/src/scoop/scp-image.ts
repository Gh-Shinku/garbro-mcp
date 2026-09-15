// Format reference: GARbro "ArcFormats/Scoop/ImageSCP.cs", class `ScpFormat` (Scoop compressed bitmap).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	readBmpHeaderFields,
	readBmpImage,
	writeBmpImage,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** `SCPz`, the word the reference registers the format under. */
const SIGNATURE: Buffer = Buffer.from("SCPz", "latin1");
const HEADER_SIZE = 8;
const SIZE_FIELD = 4;
/** The word the length behind the signature is turned by. */
const HEADER_KEY = 0x65641538;
/** As much of the picture as the reference unfolds to find the bitmap header and its measurements. */
const PREFIX_SIZE = 0x36;
/** The key the first literal of a stream is turned by. */
const LITERAL_KEY = 0x7f;
const MAXIMUM_PICTURE_BYTES = 256 * 1024 * 1024;

export interface ScpLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** How long the picture the stream unfolds into is. */
	length: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The stream the picture is stored in, with every read checked against the end of the file. */
class ScpStream {
	#at: number;

	constructor(
		readonly data: Buffer,
		at = 0,
	) {
		this.#at = at;
	}

	byte(): number {
		if (this.#at >= this.data.length) {
			throw invalidPicture("Unexpected end of Scoop picture");
		}
		const value = this.data[this.#at] ?? 0;
		this.#at += 1;
		return value;
	}

	word(): number {
		const low = this.byte();
		const high = this.byte();
		return low | (high << 8);
	}

	/** The control word is read from the file the same way round as the rest of it. */
	long(): number {
		const low = this.word();
		const high = this.word();
		return (low | (high << 16)) >>> 0;
	}
}

/**
 * The reference's `ScpFormat.Unpack`: a control word names, from its **highest** bit down, whether the byte
 * behind it is a literal or a run. A stream whose control word runs out reads the next one, and the bit that
 * was read on the way out of the last one is spent without being acted upon.
 */
export function unpackScp(stored: Buffer, output: Buffer): void {
	const stream = new ScpStream(stored);
	let destination = 0;
	let key = LITERAL_KEY;
	let previousKey = 0;
	let control = 0;
	while (destination < output.length) {
		const bit = control >>> 31;
		control = (control << 1) >>> 0;
		if (0 === control) {
			control = stream.long();
			continue;
		}
		if (0 === bit) {
			previousKey = key;
			key = (key ^ stream.byte()) & 0xff;
			output[destination] = key;
			destination += 1;
			continue;
		}
		// The word of the run is added to what is left of the control word, which is what carries the highest
		// bits of a long distance. Both are words of their own, so the sum is one as well.
		const offset = (stream.word() + (control & 0xffff)) & 0xffff;
		let count = (offset >> 12) & 0xf;
		if (0 === count) {
			count = (previousKey + stream.byte()) & 0xff;
			if (0 === count) break;
			count += 15;
		}
		count = Math.min(count + 2, output.length - destination);
		if (
			!copyOverlapped(
				output,
				destination + ~(offset & 0xfff),
				destination,
				count,
			)
		) {
			throw invalidPicture("Scoop run reaches outside its picture");
		}
		destination += count;
	}
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/**
 * The reference's `ScpFormat.ReadMetaData`: the length of the picture is turned by a word of its own, and the
 * measurements come out of the bitmap header the first fifty four bytes of the picture hold.
 */
export function readScpLayout(stored: Buffer): ScpLayout | undefined {
	if (stored.length < HEADER_SIZE) return undefined;
	if (!stored.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const length = (stored.readUInt32LE(SIZE_FIELD) ^ HEADER_KEY) >>> 0;
	if (0 === length) return undefined;
	const prefix: Buffer = Buffer.alloc(PREFIX_SIZE, 0x00);
	unpackScp(stored.subarray(HEADER_SIZE), prefix);
	const fields = readBmpHeaderFields(prefix);
	if (!fields) return undefined;
	return { ...fields, length };
}

export const scoopScpImageDescriptor: FormatDescriptor = {
	id: "scoop-scp-image",
	name: "Scoop compressed bitmap",
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
			source: "ArcFormats/Scoop/ImageSCP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const scoopScpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: scoopScpImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return readScpLayout(await readStored(source)) !== undefined;
		} catch {
			// The reference lets a stream that ends early pass by without a picture.
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readScpLayout(await readStored(source));
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Scoop picture");
		}
		if (layout.width <= 0 || layout.height <= 0) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unsupported Scoop picture size ${layout.width}x${layout.height}`,
			);
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: 0n,
						size: source.size,
						compressed: true,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: layout.bitsPerPixel,
							unpackedSize: layout.length,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: "scoop-lz",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		void sourcePath;
		const stored = await readStored(source);
		const layout = readScpLayout(stored);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Scoop picture");
		}
		if (layout.width <= 0 || layout.height <= 0) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unsupported Scoop picture size ${layout.width}x${layout.height}`,
			);
		}
		if (layout.length > MAXIMUM_PICTURE_BYTES) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`Scoop picture of ${layout.length} bytes is too large`,
			);
		}
		const picture: Buffer = Buffer.alloc(layout.length, 0x00);
		unpackScp(stored.subarray(HEADER_SIZE), picture);
		const image = readBmpImage(picture);
		if (!image) {
			throw invalidPicture("Scoop picture holds no bitmap");
		}
		return Readable.from([writeBmpImage(image)]);
	},
});
