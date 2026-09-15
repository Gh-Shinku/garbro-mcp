// Format reference: GARbro "ArcFormats/Triangle/ImageTRI.cs", classes `TriFormat` and `TriMetaData`
// (Triangle image format). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** `TRIz`, the word the reference registers the format under, and the two words behind it. */
const SIGNATURE: Buffer = Buffer.from("TRIz", "latin1");
const HEADER_SIZE = 8;
const UNPACKED_SIZE_FIELD = 4;
/** What the stored size is exclusive-ored with. */
const SIZE_KEY = 0x65641538;
/** The reference reads the header of the bitmap it will find out of the first fifty six bytes. */
const BITMAP_PREFIX = 56;
const MAXIMUM_BITMAP_BYTES = 256 * 1024 * 1024;

/** The stream the unpacker reads, which reports the end of the file the way the reference's own does. */
interface TriStream {
	byte(): number;
	word(): number;
	long(): number;
}

function triStream(stored: Buffer): TriStream {
	let cursor = HEADER_SIZE;
	const need = (count: number): number => {
		if (cursor + count > stored.length) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Unexpected end of Triangle image",
			);
		}
		const at = cursor;
		cursor += count;
		return at;
	};
	return {
		byte: () => stored[need(1)] ?? 0,
		word: () => stored.readUInt16LE(need(2)),
		long: () => stored.readUInt32LE(need(4)),
	};
}

/**
 * The reference's `TriFormat.Unpack`: a stream of two opcodes steered by the bits of a control word, which is
 * read a word at a time and consumed from its highest bit down.
 *
 * * a clear bit reads a byte and exclusive-ors it into a running key, which the picture holds;
 * * a set bit names a run: the word behind it carries the distance and, unless it names the longest runs, the
 *   count, and the run repeats what the picture already holds.
 */
function unpackTri(stored: Buffer, output: Buffer): void {
	const stream = triStream(stored);
	let destination = 0;
	let key = 0x7f;
	let previousKey = 0;
	let control = 0;
	while (destination < output.length) {
		let bit = (control & 0x80000000) >>> 0;
		control = (control << 1) >>> 0;
		if (0 === control) {
			control = stream.long();
			bit = (control & 0x80000000) >>> 0;
			control = (control << 1) >>> 0;
		}
		if (0 === bit) {
			previousKey = key;
			key = (key ^ stream.byte()) & 0xff;
			output[destination] = key;
			destination += 1;
			continue;
		}
		// The word of the run is added to what is left of the control word, which is what carries the highest
		// bits of a long distance.
		const offset = stream.word() + (control | 0);
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
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Triangle image run reaches outside the picture",
			);
		}
		destination += count;
	}
}

/** The size the header declares, exclusive-ored with the word the format uses. */
async function readTriSize(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
	return header.readInt32LE(UNPACKED_SIZE_FIELD) ^ SIZE_KEY;
}

/** The measurements of the bitmap the picture holds, read out of the first fifty six bytes of it. */
async function readTriFields(source: ByteSource) {
	const prefix: Buffer = Buffer.alloc(BITMAP_PREFIX, 0x00);
	const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
	unpackTri(stored, prefix);
	return readBmpHeaderFields(prefix);
}

/** The whole picture, unpacked and written out as the bitmap it holds. */
async function renderTriImage(source: ByteSource): Promise<Buffer> {
	const size = await readTriSize(source);
	if (size === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Triangle image");
	}
	if (size <= 0) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`Triangle image declares ${size} bytes`,
		);
	}
	if (size > MAXIMUM_BITMAP_BYTES) {
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			`Triangle image of ${size} bytes is too large`,
		);
	}
	const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
	const unpacked: Buffer = Buffer.alloc(size, 0x00);
	unpackTri(stored, unpacked);
	const image = readBmpImage(unpacked);
	if (!image) {
		throw new GarbroError("INVALID_ARCHIVE", "Triangle image holds no bitmap");
	}
	return writeBmpImage(image);
}

export const triangleTriImageDescriptor: FormatDescriptor = {
	id: "triangle-tri-image",
	name: "Triangle image",
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
			source: "ArcFormats/Triangle/ImageTRI.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const triangleTriImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: triangleTriImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readTriFields(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const size = await readTriSize(source);
		const fields = await readTriFields(source);
		if (size === undefined || !fields) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Triangle image");
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
							width: fields.width,
							height: fields.height,
							bitsPerPixel: fields.bitsPerPixel,
							unpackedSize: size,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: "triangle-rle",
				width: fields.width,
				height: fields.height,
				bitsPerPixel: fields.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		void sourcePath;
		return Readable.from([await renderTriImage(source)]);
	},
});
