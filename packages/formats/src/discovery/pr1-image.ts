// Format reference: GARbro "Legacy/Discovery/ImagePR1.cs", classes `Pr1Format`, `PrMetaData` and `PrReader`
// (Discovery image). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp4 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	sourceExtension,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 12;
const PALETTE_OFFSET = 0xc;
const PALETTE_ENTRIES = 16;
const PALETTE_BYTES = PALETTE_ENTRIES * 3;
/** Where the compressed stream begins: the header, then the colour map the reference reads with it. */
export const PIXEL_OFFSET = PALETTE_OFFSET + PALETTE_BYTES;
const PLANE_COUNT = 4;
/** Four windows of two hundred and fifty six groups of four bytes, and the room an append needs. */
const WINDOW_SIZE = 0x410;
const MAX_PLANE_BYTES = 256 * 1024 * 1024;

export interface PrLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	/** The first byte of the header, of which the lowest bit picks the walk over the picture. */
	flags: number;
	/** The second byte, which the reference's own reader ignores. */
	mask: number;
	/** Bytes of one row of a plane: eight pixels to the byte. */
	stride: number;
	planeSize: number;
}

/** A reader over the stored bytes that keeps the reference's two ways of failing. */
class PrStream {
	private position: number;

	constructor(
		private readonly data: Buffer,
		position: number,
	) {
		this.position = position;
	}

	/** `IBinaryStream.ReadByte`: the byte, or minus one at the end of the stream. */
	readByteOrEnd(): number {
		if (this.position >= this.data.length) return -1;
		const value = this.data[this.position] ?? 0;
		this.position += 1;
		return value;
	}

	/** `IBinaryStream.ReadUInt8`, which the reference's opcodes use: a stream that ends is a failure. */
	readByte(): number {
		const value = this.readByteOrEnd();
		if (-1 === value) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Unexpected end of Discovery image",
			);
		}
		return value;
	}
}

/** The colour map, sixteen colours of three bytes in the order green, red, blue, each scaled by seventeen. */
export function readPrPalette(stored: Buffer): Buffer {
	const palette: Buffer = Buffer.alloc(PALETTE_ENTRIES * 3, 0x00);
	for (let i = 0; i < PALETTE_ENTRIES; i += 1) {
		const source = PALETTE_OFFSET + i * 3;
		const green = stored[source] ?? 0;
		const red = stored[source + 1] ?? 0;
		const blue = stored[source + 2] ?? 0;
		// A bitmap wants red, green and blue, and the port keeps the order its writer expects.
		palette[i * 3] = (red * 0x11) & 0xff;
		palette[i * 3 + 1] = (green * 0x11) & 0xff;
		palette[i * 3 + 2] = (blue * 0x11) & 0xff;
	}
	return palette;
}

function writePixel(plane: Uint8Array, index: number, value: number): void {
	if (index < 0 || index >= plane.length) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Discovery image run reaches past a plane",
		);
	}
	plane[index] = value;
}

/** A byte written into one of the windows, which the reference writes straight through an array. */
function writeWindow(buffer: Uint8Array, index: number, value: number): void {
	if (index < 0 || index >= buffer.length) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Discovery image window has run over",
		);
	}
	buffer[index] = value;
}

function windowByte(buffer: Uint8Array, index: number): number {
	if (index < 0 || index >= buffer.length) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Discovery image reaches outside its window",
		);
	}
	return buffer[index] ?? 0;
}

/**
 * The reference's `PrReader.UnpackPlanes`: four pictures of one bit each, woven from a stream of opcodes that
 * keeps four sliding windows of what it has already written.
 */
export function unpackPrPlanes(stored: Buffer, layout: PrLayout): Uint8Array[] {
	const { stride, planeSize } = layout;
	const planes: Uint8Array[] = [];
	for (let i = 0; i < PLANE_COUNT; i += 1) {
		planes.push(new Uint8Array(planeSize));
	}
	const buffer = new Uint8Array(WINDOW_SIZE * PLANE_COUNT);
	const counts = new Uint8Array(PLANE_COUNT);
	const offsets = new Uint32Array([
		0,
		WINDOW_SIZE,
		WINDOW_SIZE * 2,
		WINDOW_SIZE * 3,
	]);
	const stream = new PrStream(stored, PIXEL_OFFSET);
	const leftToRight = 0 !== (layout.flags & 1);
	let destination = 0;
	let x = 0;

	const increment = (): void => {
		if (leftToRight) {
			destination += 1;
			x += 1;
			// The reference wraps one pixel late, which has no effect on anything else it does.
			if (x > layout.width) x = 0;
		} else {
			destination += stride;
			if (destination >= planeSize) {
				x += 1;
				destination = x;
			}
		}
	};

	const put = (p0: number, p1: number, p2: number, p3: number): void => {
		writePixel(planes[0] as Uint8Array, destination, p0);
		writePixel(planes[1] as Uint8Array, destination, p1);
		writePixel(planes[2] as Uint8Array, destination, p2);
		writePixel(planes[3] as Uint8Array, destination, p3);
		increment();
	};

	const done = (): boolean =>
		leftToRight ? destination >= planeSize : x >= stride;

	while (!done()) {
		const control = stream.readByteOrEnd();
		if (-1 === control) break;
		let count = (control & 0x1f) + 1;
		const windowed = 0 !== (control & 0x20);
		const selector = control >> 6;
		if (!windowed) {
			if (0 !== selector) {
				const slice = selector;
				const groups = 1 << (slice - 1);
				// The reference appends at the window offset it started with and moves the window on from that
				// same offset, not from where the append ended.
				const windowStart = offsets[slice] ?? 0;
				let position = windowStart;
				let group = groups;
				do {
					const p0 = stream.readByte();
					const p1 = stream.readByte();
					const p2 = stream.readByte();
					const p3 = stream.readByte();
					put(p0, p1, p2, p3);
					for (const value of [p0, p1, p2, p3]) {
						writeWindow(buffer, position, value);
						position += 1;
					}
					count -= 1;
					group -= 1;
				} while (count > 0 && group > 0);
				while (count > 0) {
					let source = offsets[slice] ?? 0;
					for (let i = 0; i < groups; i += 1) {
						put(
							windowByte(buffer, source),
							windowByte(buffer, source + 1),
							windowByte(buffer, source + 2),
							windowByte(buffer, source + 3),
						);
						source += 4;
						count -= 1;
						if (count <= 0) break;
					}
				}
				// The reference moves the window on by the whole group it meant to write, whether or not the
				// opcode had enough pixels left to fill it.
				offsets[slice] = windowStart + groups * 4;
				const counted = ((counts[slice] ?? 0) + groups) & 0xff;
				counts[slice] = counted;
				if (0 === counted) offsets[slice] = slice * WINDOW_SIZE;
			} else {
				while (count > 0) {
					count -= 1;
					const p0 = stream.readByte();
					const p1 = stream.readByte();
					const p2 = stream.readByte();
					const p3 = stream.readByte();
					put(p0, p1, p2, p3);
					for (const value of [p0, p1, p2, p3]) {
						writeWindow(buffer, offsets[0] ?? 0, value);
						offsets[0] = (offsets[0] ?? 0) + 1;
					}
					const counted = ((counts[0] ?? 0) + 1) & 0xff;
					counts[0] = counted;
					if (0 === counted) offsets[0] = 0;
				}
			}
		} else if (0 !== selector) {
			const groups = 1 << (selector - 1);
			const difference = groups << 2;
			const mask = difference - 1;
			const base = selector * WINDOW_SIZE;
			const source = (stream.readByte() << 2) + base;
			while (count > 0) {
				let position = source;
				for (let i = 0; i < groups; i += 1) {
					put(
						windowByte(buffer, position),
						windowByte(buffer, position + 1),
						windowByte(buffer, position + 2),
						windowByte(buffer, position + 3),
					);
					position += 4;
					const within = position - base;
					if (0 === (within & mask)) position -= difference;
					count -= 1;
					if (count <= 0) break;
				}
			}
		} else {
			while (count > 0) {
				count -= 1;
				const position = stream.readByte() << 2;
				put(
					windowByte(buffer, position),
					windowByte(buffer, position + 1),
					windowByte(buffer, position + 2),
					windowByte(buffer, position + 3),
				);
			}
		}
	}
	return planes;
}

/** The reference's `PrReader.FlattenPlanes`: the four pictures woven back into whole four bit pixels. */
export function flattenPrPlanes(
	planes: Uint8Array[],
	planeSize: number,
	from: number,
	output: Buffer,
): void {
	let destination = 0;
	for (let source = from; source < planeSize; source += 1) {
		if (source >= (planes[0]?.length ?? 0)) {
			// The animation resource asks for more frames than its planes hold, which the reference's own
			// flattening walks past the end of an array for.
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Discovery image flattening reaches past a plane",
			);
		}
		const b0 = planes[0]?.[source] ?? 0;
		const b1 = planes[1]?.[source] ?? 0;
		const b2 = planes[2]?.[source] ?? 0;
		const b3 = planes[3]?.[source] ?? 0;
		for (let j = 0; j < 8; j += 2) {
			let pixel =
				((((b0 << j) & 0x80) >> 3) |
					(((b1 << j) & 0x80) >> 2) |
					(((b2 << j) & 0x80) >> 1) |
					((b3 << j) & 0x80)) &
				0xff;
			pixel |=
				((((b0 << j) & 0x40) >> 6) |
					(((b1 << j) & 0x40) >> 5) |
					(((b2 << j) & 0x40) >> 4) |
					(((b3 << j) & 0x40) >> 3)) &
				0xff;
			output[destination] = pixel & 0xff;
			destination += 1;
		}
	}
}

/**
 * The header the two Discovery pictures share. The reference reads it for a file whose extension is one of the
 * two and checks nothing else — not even a measurement of nought.
 */
export async function readPrLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<PrLayout | undefined> {
	const extension = sourceExtension(sourcePath);
	if ("pr1" !== extension && "an1" !== extension) return undefined;
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (header.length < HEADER_SIZE) return undefined;
	const width = header.readUInt16LE(8) << 3;
	const height = header.readUInt16LE(10);
	const stride = width >> 3;
	return {
		width,
		height,
		offsetX: header.readUInt16LE(2),
		offsetY: header.readUInt16LE(4),
		flags: header[0] ?? 0,
		mask: header[1] ?? 0,
		stride,
		planeSize: stride * height,
	};
}

function checkLayout(layout: PrLayout): void {
	if (0 === layout.width || 0 === layout.height) {
		// The reference hands such a picture to the framework, which refuses a bitmap of no pixels.
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`Unsupported Discovery image size ${layout.width}x${layout.height}`,
		);
	}
	if (
		!Number.isSafeInteger(layout.planeSize) ||
		layout.planeSize > MAX_PLANE_BYTES
	) {
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			`Discovery image of ${layout.width}x${layout.height} is too large`,
		);
	}
}

/** The bytes of the whole file, the palette and the stream both living in them. */
async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** The four bit picture of a file of this format, as a bitmap of sixteen colours. */
export async function renderPrImage(
	source: ByteSource,
	layout: PrLayout,
): Promise<Buffer> {
	checkLayout(layout);
	const stored = await readStored(source);
	if (stored.length < PIXEL_OFFSET) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Truncated Discovery image palette",
		);
	}
	const palette = readPrPalette(stored);
	const planes = unpackPrPlanes(stored, layout);
	// Two pixels to the byte, so a plane of eight pixel bytes becomes four bytes of picture.
	const output: Buffer = Buffer.alloc(layout.planeSize * 4, 0x00);
	flattenPrPlanes(planes, layout.planeSize, 0, output);
	// `ImageData.Create` keeps the order the planes were woven in, which a bitmap records with a negative
	// height.
	return writeBmp4(layout.width, layout.height, output, palette);
}

export const discoveryPr1ImageDescriptor: FormatDescriptor = {
	id: "discovery-pr1-image",
	name: "Discovery image",
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
			source: "Legacy/Discovery/ImagePR1.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const discoveryPr1ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: discoveryPr1ImageDescriptor,
	// The reference registers no signature at all and finds its pictures by their extension instead.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readPrLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readPrLayout(source, sourcePath);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Discovery PR1 image");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
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
					bitsPerPixel: 4,
					colors: PALETTE_ENTRIES,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
					flags: layout.flags,
					mask: layout.mask,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "discovery-rle",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 4,
				colors: PALETTE_ENTRIES,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		const layout = await readPrLayout(source, sourcePath);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Discovery PR1 image");
		}
		return Readable.from([await renderPrImage(source, layout)]);
	},
});
