// Format reference: GARbro "ArcFormats/Marble/ImagePRS.cs", classes `PrsFormat`, `PrsMetaData` and
// `Reader` (a Marble picture packed by a walk of three kinds of copy, behind a `YB` tag). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The two letters the reference signs the format with; it declares no signature word of its own. */
const SIGNATURE = Buffer.from("YB", "latin1");
const HEADER_SIZE = 0x10;
const FLAG_FIELD = 2;
const DEPTH_FIELD = 3;
const PACKED_SIZE_FIELD = 4;
const WIDTH_FIELD = 12;
const HEIGHT_FIELD = 14;
/** The flag that says the pixels are a differential walk. */
const DELTA_FLAG = 0x80;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface PrsLayout {
	width: number;
	height: number;
	/** Three or four bytes a pixel. */
	depth: number;
	flag: number;
	packedSize: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `PrsFormat.ReadMetaData`: the first two bytes are `YB`, the third is a flag, the fourth is the depth, of
 * which three or four bytes a pixel is allowed, and the packed size stands at four with the measurements at
 * twelve and fourteen. The depth the reference reports is eight bits a channel.
 */
export function readPrsLayout(data: Buffer): PrsLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (data[0] !== 0x59 || data[1] !== 0x42) return undefined;
	const depth = data[DEPTH_FIELD] ?? 0;
	if (depth !== 3 && depth !== 4) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	const size = width * height * depth;
	if (!Number.isSafeInteger(size) || size > LIMIT) return undefined;
	return {
		width,
		height,
		depth,
		flag: data[FLAG_FIELD] ?? 0,
		packedSize: data.readUInt32LE(PACKED_SIZE_FIELD),
	};
}

/** `Reader.InitLengthTable`: two hundred and fifty five steps that grow, and two long ones of their own. */
const LENGTH_TABLE: readonly number[] = (() => {
	const table = new Array<number>(256).fill(0);
	for (let i = 0; i < 0xfe; i += 1) table[i] = i + 3;
	table[0xfe] = 0x400;
	table[0xff] = 0x1000;
	return table;
})();

/**
 * `Reader.Unpack`: the walk begins at the sixteenth byte and is bounded by the packed size it declares, so
 * every byte it reads counts against that size whether it is a control byte, a literal or a copy. A control
 * byte is read when the last of its eight bits has been used, and its bits are taken from the **highest**
 * down: a clear bit is a literal byte, a set bit a copy whose own byte says which of three kinds it is.
 *
 * | the byte behind the control | what it means |
 * | --- | --- |
 * | highest bit clear, two low bits below three | the count is the two low bits plus two, the distance the rest plus one |
 * | highest bit clear, two low bits all set | that many bytes stand in the stream themselves, nine more than the rest of the byte says |
 * | highest bit set, bit six clear | the count is the low nibble of the word behind it plus three, the distance the rest of the word plus one |
 * | highest bit set, bit six set | the count stands in a table of its own, read from the byte behind the word, and the distance is the word plus one |
 *
 * A copy is written a byte at a time, so one whose distance is one repeats the byte before it. The reference
 * clamps a copy to what is left of the picture rather than refusing it, which this port does as well, while a
 * literal run that reaches past the end is refused where the reference's own array read would throw. When the
 * flag's highest bit stands, every byte behind the first pixel is a differential step of the byte one pixel
 * before it, across the whole picture. A four byte picture whose alpha channel holds one value throughout,
 * other than the greatest one, is reported as having no alpha channel at all, which the reference does by
 * handing it out as `Bgr32`.
 */
export function unpackPrs(input: Buffer, layout: PrsLayout): Buffer {
	const stride = layout.width * layout.depth;
	const output: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	let position = HEADER_SIZE;
	let remaining = layout.packedSize;
	let dst = 0;
	let bit = 0;
	let control = 0;
	const readByte = (): number => {
		if (position >= input.length || remaining <= 0) {
			throw invalidPicture("Marble picture is cut short of its stream");
		}
		const value = input[position] ?? 0;
		position += 1;
		remaining -= 1;
		return value;
	};
	while (remaining > 0 && dst < output.length) {
		bit >>= 1;
		if (0 === bit) {
			control = readByte();
			bit = 0x80;
		}
		if (remaining <= 0) break;
		if (0 === (control & bit)) {
			output[dst] = readByte();
			dst += 1;
			continue;
		}
		const word = readByte();
		let length: number;
		let distance: number;
		if (0 !== (word & 0x80)) {
			const low = readByte();
			let value = low | ((word & 0x3f) << 8);
			if (0 !== (word & 0x40)) {
				length = LENGTH_TABLE[readByte()] ?? 0;
			} else {
				length = (value & 0xf) + 3;
				value >>= 4;
			}
			distance = value + 1;
		} else {
			length = word >> 2;
			const kind = word & 3;
			if (3 === kind) {
				length += 9;
				if (dst + length > output.length) {
					throw invalidPicture("Marble picture writes past its own end");
				}
				const available = Math.min(length, input.length - position);
				for (let index = 0; index < available; index += 1) {
					output[dst + index] = input[position + index] ?? 0;
				}
				position += available;
				if (available < length) break;
				remaining -= length;
				dst += length;
				continue;
			}
			distance = length + 1;
			length = kind + 2;
		}
		if (dst < distance) {
			throw invalidPicture("Marble picture copies from before its own start");
		}
		const run = Math.min(length, output.length - dst);
		for (let index = 0; index < run; index += 1) {
			output[dst + index] = output[dst + index - distance] ?? 0;
		}
		dst += run;
	}
	if (0 !== (layout.flag & DELTA_FLAG)) {
		for (let index = layout.depth; index < output.length; index += 1) {
			output[index] =
				((output[index] ?? 0) + (output[index - layout.depth] ?? 0)) & 0xff;
		}
	}
	return output;
}

/** `Reader.IsDummyAlphaChannel`: one alpha value throughout, other than the greatest one. */
export function hasDummyAlpha(pixels: Buffer): boolean {
	if (pixels.length < 4) return false;
	const alpha = pixels[3] ?? 0;
	if (0xff === alpha) return false;
	for (let index = 7; index < pixels.length; index += 4) {
		if (pixels[index] !== alpha) return false;
	}
	return true;
}

async function readLayout(source: ByteSource): Promise<PrsLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		return readPrsLayout(header);
	} catch {
		return undefined;
	}
}

export const marblePrsImageDescriptor: FormatDescriptor = {
	id: "marble-prs-image",
	name: "Marble engine image format",
	extensions: ["prs"],
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
			source: "ArcFormats/Marble/ImagePRS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const marblePrsImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: marblePrsImageDescriptor,
	// The reference declares no signature word; the two letters of its tag are the only gate.
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Marble picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 8 * layout.depth,
					depth: layout.depth,
				},
			}),
			// The pixels are unfolded from a packed stream and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "custom",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8 * layout.depth,
				depth: layout.depth,
				delta: 0 !== (layout.flag & DELTA_FLAG),
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Marble picture");
		}
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const pixels = unpackPrs(stored, layout);
		if (layout.depth === 3) {
			// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
			return Readable.from([writeBmp24(layout.width, layout.height, pixels)]);
		}
		const alpha = hasDummyAlpha(pixels);
		if (alpha) {
			// The reference hands the picture out as `Bgr32`, whose fourth byte a bitmap does not carry.
			const opaque = Buffer.from(pixels);
			for (let index = 3; index < opaque.length; index += 4) opaque[index] = 0;
			return Readable.from([writeBmp32(layout.width, layout.height, opaque)]);
		}
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
