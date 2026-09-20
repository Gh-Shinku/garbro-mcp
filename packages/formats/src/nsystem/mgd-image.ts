// Format reference: GARbro ArcFormats/NSystem/ImageMGD.cs (classes `MgdFormat` and `MgdDecoder`).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `MgdFormat.Signature`: the four letters `MGD ` read as a little endian word. */
const SIGNATURE = Buffer.from("MGD ", "latin1");
const HEADER_SIZE = 0x1c;
const WIDTH_AT = 0x0c;
const HEIGHT_AT = 0x0e;
const UNPACKED_SIZE_AT = 0x10;
const MODE_AT = 0x18;
/** The header declares four bytes to a pixel whatever the mode stores. */
const PIXEL_SIZE = 4;
const ALPHA_AT = 3;
const MODE_RAW = 0;
const MODE_PACKED = 1;
const MODE_PNG = 2;
const MAXIMUM_MODE = 2;
/** The three group kinds of the colour walk, in the top two bits of its flag. */
const GROUP_LITERAL = 0x00;
const GROUP_RUN = 0x40;
const GROUP_DELTA = 0x80;

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export interface MgdLayout {
	readonly width: number;
	readonly height: number;
	/** The word at 4, which is where the picture data starts. */
	readonly dataOffset: number;
	readonly unpackedSize: number;
	readonly mode: number;
}

/** `MgdFormat.ReadMetaData`, with the signature check the reference leaves to its catalogue. */
export function readMgdLayout(data: Buffer): MgdLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, 4).equals(SIGNATURE)) return undefined;
	const mode = data.readInt32LE(MODE_AT);
	if (mode < 0 || mode > MAXIMUM_MODE) return undefined;
	return {
		width: data.readUInt16LE(WIDTH_AT),
		height: data.readUInt16LE(HEIGHT_AT),
		dataOffset: data.readUInt16LE(4),
		unpackedSize: data.readInt32LE(UNPACKED_SIZE_AT),
		mode,
	};
}

function writePixel(
	output: Buffer,
	at: number,
	blue: number,
	green: number,
	red: number,
): void {
	if (at + PIXEL_SIZE > output.length)
		throw invalidPicture("NSystem picture outgrew its unpacked size");
	output[at] = blue & 0xff;
	output[at + 1] = green & 0xff;
	output[at + 2] = red & 0xff;
}

function writeAlpha(output: Buffer, at: number, value: number): void {
	if (at >= output.length)
		throw invalidPicture("NSystem picture outgrew its unpacked size");
	output[at] = value & 0xff;
}

/** `MgdDecoder.UnpackAlpha`: a run of one value or a list of values, two bytes to a count. */
function decodeMgdAlpha(
	data: Buffer,
	at: number,
	length: number,
	output: Buffer,
): { at: number; hasAlpha: boolean } {
	let position = at;
	let remaining = length;
	let destination = ALPHA_AT;
	let hasAlpha = false;
	while (remaining > 0) {
		if (position + 2 > data.length)
			throw invalidPicture("NSystem alpha channel ends inside a count");
		let count = data.readInt16LE(position);
		position += 2;
		remaining -= 2;
		if (count < 0) {
			count = (count & 0x7fff) + 1;
			if (position >= data.length)
				throw invalidPicture("NSystem alpha channel ends inside a run");
			const value = data[position] ?? 0;
			position += 1;
			remaining -= 1;
			if (0 !== value) hasAlpha = true;
			for (let i = 0; i < count; i += 1) {
				writeAlpha(output, destination, value);
				destination += PIXEL_SIZE;
			}
			continue;
		}
		// A count of zero is legal when it has taken up the whole length; otherwise the reference reads
		// another count, which ends at the end of the stream.
		for (let i = 0; i < count; i += 1) {
			if (position >= data.length)
				throw invalidPicture("NSystem alpha channel ends inside its values");
			const value = data[position] ?? 0;
			position += 1;
			if (0 !== value) hasAlpha = true;
			writeAlpha(output, destination, value);
			destination += PIXEL_SIZE;
		}
		remaining -= count;
	}
	return { at: position, hasAlpha };
}

/**
 * `MgdDecoder.UnpackColor`: three kinds of group. A literal group carries its pixels as three bytes each,
 * a run group carries one pixel and repeats it, and a delta group carries two byte differences from the
 * pixel in front of it, either five bits to a channel or four with a sign bit of its own.
 */
function decodeMgdColour(
	data: Buffer,
	at: number,
	length: number,
	output: Buffer,
): { at: number } {
	let position = at;
	let remaining = length;
	let destination = 0;
	while (remaining > 0) {
		if (position >= data.length)
			throw invalidPicture("NSystem colour channel ends inside a flag");
		const flag = data[position] ?? 0;
		position += 1;
		remaining -= 1;
		const group = flag & 0xc0;
		const count = flag & 0x3f;
		if (GROUP_DELTA === group) {
			if (destination < PIXEL_SIZE)
				throw invalidPicture("NSystem difference has no pixel before it");
			let blue = output[destination - PIXEL_SIZE] ?? 0;
			let green = output[destination - PIXEL_SIZE + 1] ?? 0;
			let red = output[destination - PIXEL_SIZE + 2] ?? 0;
			for (let i = 0; i < count; i += 1) {
				if (position + 2 > data.length)
					throw invalidPicture(
						"NSystem colour channel ends inside a difference",
					);
				const delta = data.readUInt16LE(position);
				position += 2;
				remaining -= 2;
				if (0 !== (delta & 0x8000)) {
					red += (delta >> 10) & 0x1f;
					green += (delta >> 5) & 0x1f;
					blue += delta & 0x1f;
				} else {
					red +=
						0 !== (delta & 0x4000)
							? -((delta >> 10) & 0x0f)
							: (delta >> 10) & 0x0f;
					green +=
						0 !== (delta & 0x0200)
							? -((delta >> 5) & 0x0f)
							: (delta >> 5) & 0x0f;
					blue += 0 !== (delta & 0x0010) ? -(delta & 0x0f) : delta & 0x0f;
				}
				writePixel(output, destination, blue, green, red);
				destination += PIXEL_SIZE;
			}
			continue;
		}
		if (GROUP_RUN === group) {
			if (position + 3 > data.length)
				throw invalidPicture("NSystem colour channel ends inside a run");
			const blue = data[position] ?? 0;
			const green = data[position + 1] ?? 0;
			const red = data[position + 2] ?? 0;
			position += 3;
			remaining -= 3;
			writePixel(output, destination, blue, green, red);
			destination += PIXEL_SIZE;
			for (let i = 0; i < count; i += 1) {
				writePixel(output, destination, blue, green, red);
				destination += PIXEL_SIZE;
			}
			continue;
		}
		if (GROUP_LITERAL !== group)
			throw invalidPicture("Unknown NSystem colour group");
		for (let i = 0; i < count; i += 1) {
			if (position + 3 > data.length)
				throw invalidPicture("NSystem colour channel ends inside its pixels");
			writePixel(
				output,
				destination,
				data[position] ?? 0,
				data[position + 1] ?? 0,
				data[position + 2] ?? 0,
			);
			position += 3;
			remaining -= 3;
			destination += PIXEL_SIZE;
		}
	}
	return { at: position };
}

export interface MgdPixels {
	/** Four bytes to a pixel, blue first. */
	readonly pixels: Buffer;
	/** Whether any stored alpha byte was not zero, which decides the bitmap depth. */
	readonly hasAlpha: boolean;
}

/** `MgdFormat.Read`: the three modes, of which the third hands its payload to an image library. */
export function decodeMgdPixels(data: Buffer, layout: MgdLayout): MgdPixels {
	if (layout.dataOffset + 4 > data.length)
		throw invalidPicture("NSystem picture has no data word");
	const frame = layout.width * layout.height * PIXEL_SIZE;
	switch (layout.mode) {
		case MODE_RAW: {
			const size = data.readInt32LE(layout.dataOffset);
			if (size < 0 || layout.dataOffset + 4 + size > data.length)
				throw invalidPicture("NSystem picture data reaches past the file");
			const stored = data.subarray(
				layout.dataOffset + 4,
				layout.dataOffset + 4 + size,
			);
			if (stored.length < frame)
				throw invalidPicture("NSystem picture is shorter than its frame");
			const pixels = Buffer.alloc(frame);
			stored.copy(pixels, 0, 0, frame);
			let hasAlpha = false;
			for (let at = ALPHA_AT; at < frame; at += PIXEL_SIZE) {
				if (0 !== (pixels[at] ?? 0)) {
					hasAlpha = true;
					break;
				}
			}
			return { pixels, hasAlpha };
		}
		case MODE_PACKED: {
			const output = Buffer.alloc(frame);
			// `MgdFormat.Read` takes a length word the decoder itself never looks at, so the alpha
			// length follows it, exactly as the reference's own stream reads them in turn.
			if (layout.dataOffset + 8 > data.length)
				throw invalidPicture("NSystem picture has no alpha length word");
			const alphaSize = data.readInt32LE(layout.dataOffset + 4);
			if (alphaSize < 0)
				throw invalidPicture("NSystem alpha channel declares no length");
			const alpha = decodeMgdAlpha(
				data,
				layout.dataOffset + 8,
				alphaSize,
				output,
			);
			if (alpha.at + 4 > data.length)
				throw invalidPicture("NSystem colour channel has no length word");
			const colourSize = data.readInt32LE(alpha.at);
			decodeMgdColour(data, alpha.at + 4, colourSize, output);
			return { pixels: output, hasAlpha: alpha.hasAlpha };
		}
		case MODE_PNG:
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				"NSystem picture of mode two holds a PNG, which the reference hands to an image library and this project does not decode",
			);
		default:
			throw invalidPicture("Unknown NSystem picture mode");
	}
}

/** Writes the four byte pixels as the bitmap depth the stored alpha channel calls for. */
export function packMgdBitmap(pixels: MgdPixels, layout: MgdLayout): Buffer {
	if (pixels.hasAlpha)
		return writeBmp32(layout.width, layout.height, pixels.pixels);
	const packed = Buffer.alloc(layout.width * layout.height * 3);
	for (let at = 0; at * PIXEL_SIZE + 3 <= pixels.pixels.length; at += 1) {
		packed[at * 3] = pixels.pixels[at * PIXEL_SIZE] ?? 0;
		packed[at * 3 + 1] = pixels.pixels[at * PIXEL_SIZE + 1] ?? 0;
		packed[at * 3 + 2] = pixels.pixels[at * PIXEL_SIZE + 2] ?? 0;
	}
	return writeBmp24(layout.width, layout.height, packed);
}

export const nsystemMgdImageDescriptor: FormatDescriptor = {
	id: "nsystem-mgd-image",
	name: "NSystem image",
	extensions: ["mgd"],
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
			source: "ArcFormats/NSystem/ImageMGD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const nsystemMgdImageFormat = defineFixedArchive({
	descriptor: nsystemMgdImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const head = await source.readAt(0n, HEADER_SIZE);
		return readMgdLayout(head) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readMgdLayout(data);
		if (!layout) throw invalidPicture("Not an NSystem picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "bmp"),
			offset: 0n,
			size: source.size,
			compressed: MODE_RAW !== layout.mode,
			metadata: {
				type: "image",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
				mode: layout.mode,
			},
		});
		return {
			entries: [entry],
			metadata: {
				width: layout.width,
				height: layout.height,
				mode: layout.mode,
			},
		};
	},
	async openEntry(source) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readMgdLayout(data);
		if (!layout) throw invalidPicture("Not an NSystem picture");
		return Readable.from([
			packMgdBitmap(decodeMgdPixels(data, layout), layout),
		]);
	},
});
