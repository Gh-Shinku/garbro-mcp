// A reader of the JPEG interchange format, used by the GARbro formats whose payload is a JPEG that the
// reference hands to the platform decoder of the Windows imaging stack. The reference keeps no algorithm
// for such a payload, so this is a reader of the format itself rather than a port: the layout below follows
// ITU-T T.81 (JPEG), baseline sequential DCT, eight bits a sample.
//
// Read here: SOF0 and SOF1 frames of one or three components with Huffman coding, quantisation tables of
// eight or sixteen bits, restart intervals, and the Adobe colour transform marker. Turned away as an
// unsupported feature: a progressive frame (SOF2) or any other frame kind, an arithmetic coded stream, a
// frame of four or more components, a frame of twelve bits a sample, and a scan that does not hold every
// component of its frame. Turned away as an invalid stream: a broken marker walk, a broken Huffman table, a
// restart marker that is missing or out of range, and a coefficient that runs past the end of its block.
//
// The reference decodes through the platform, which upsamples chroma with a wider filter than the nearest
// sample this reader takes, so the two pictures differ by a little at the edges of a colour change. This is
// noted in the format notes that use this reader.

import { GarbroError } from "@garbro-mcp/core";

/** A decoded picture: four places a pixel, blue first, top row first, alpha filled in. */
export interface JpegImage {
	width: number;
	height: number;
	bitsPerPixel: 32;
	pixels: Buffer;
}

const BLOCK_DIM = 8;
const BLOCK_SIZE = 64;
const MAX_COMPONENTS = 4;
const MAX_CODE_LENGTH = 16;
const HUFFMAN_TABLE_COUNT = 4;
const QUANT_TABLE_COUNT = 4;
const RESTART_FIRST = 0xffd0;
const RESTART_LAST = 0xffd7;
const FULL_ALPHA = 0xff;
const BITS_PER_SAMPLE = 8;
const LEVEL_SHIFT = 128;
const PLACES_ALPHA = 4;

const SOF0 = 0xc0;
const SOF1 = 0xc1;
const SOF2 = 0xc2;
const SOF3 = 0xc3;
const DHT = 0xc4;
const RST0 = 0xd0;
const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const DQT = 0xdb;
const DRI = 0xdd;
const APP14 = 0xee;

const MARKER_PREFIX = 0xff;
const STUFFED_BYTE = 0x00;

/** The Adobe marker carries a colour transform in its twelfth byte: zero means the components are red,
 * green and blue as they are, one means they are a luminance and two chrominance places. */
const ADOBE_TRANSFORM_AT = 11;

/** The natural index of each coefficient in the order a block transmits them. */
const ZIGZAG = new Int32Array([
	0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40,
	48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29,
	22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54,
	47, 55, 62, 63,
]);

/**
 * The cosine basis of the inverse transform, halved: `COSINE[y * 8 + u]` is the weight of frequency `u`
 * at place `y`. Two passes over this table give the inverse transform of a block without any scaling
 * factor of its own, because the two halves of a quarter multiply to a quarter.
 */
const COSINE = ((): Float64Array => {
	const table = new Float64Array(BLOCK_SIZE);
	for (let place = 0; place < BLOCK_DIM; place += 1) {
		for (let frequency = 0; frequency < BLOCK_DIM; frequency += 1) {
			const scale = 0 === frequency ? Math.SQRT1_2 : 1;
			table[place * BLOCK_DIM + frequency] =
				(scale *
					Math.cos(((2 * place + 1) * frequency * Math.PI) / (2 * BLOCK_DIM))) /
				2;
		}
	}
	return table;
})();

interface HuffmanTable {
	/** The first code of each code length, one based. */
	firstCode: Int32Array;
	/** The index of the first symbol of each code length within `symbols`, one based. */
	symbolAt: Int32Array;
	/** The largest code of each code length, one based; -1 where the length carries no code. */
	largest: Int32Array;
	symbols: Uint8Array;
}

interface Component {
	id: number;
	horizontal: number;
	vertical: number;
	/** The quantisation table in natural order, as a multiple of the transmitted coefficient. */
	quant: Int32Array;
	dc: HuffmanTable;
	ac: HuffmanTable;
	blocksPerLine: number;
	blocksPerColumn: number;
	/** The width of one row of samples of this component. */
	stride: number;
	samples: Uint8Array;
	/** The running sum of the direct current coefficients, which a restart marker clears. */
	predictor: number;
}

interface Frame {
	width: number;
	height: number;
	maxHorizontal: number;
	maxVertical: number;
	mcusPerLine: number;
	mcusPerColumn: number;
	components: Component[];
	/** One when the components are a luminance and two chrominance places, zero when they are red, green
	 * and blue; undefined when the stream carries no Adobe marker. */
	transform: number | undefined;
}

interface Scan {
	frame: Frame;
	/** The place of the first byte of the coded data. */
	position: number;
	restartInterval: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupportedPicture(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

/** Reads a Huffman table from its sixteen counts and the symbols that follow them. */
function readHuffmanTable(body: Buffer, at: number): HuffmanTable {
	if (at + MAX_CODE_LENGTH > body.length) {
		throw invalidPicture("A Huffman table of the stream stands short of it");
	}
	const counts = new Int32Array(MAX_CODE_LENGTH + 1);
	let symbols = 0;
	for (let length = 1; length <= MAX_CODE_LENGTH; length += 1) {
		counts[length] = body[at + length - 1] ?? 0;
		symbols += counts[length] ?? 0;
	}
	if (at + MAX_CODE_LENGTH + symbols > body.length) {
		throw invalidPicture("The symbols of a Huffman table stand short of it");
	}
	const firstCode = new Int32Array(MAX_CODE_LENGTH + 1);
	const symbolAt = new Int32Array(MAX_CODE_LENGTH + 1);
	const largest = new Int32Array(MAX_CODE_LENGTH + 1);
	let code = 0;
	let index = 0;
	for (let length = 1; length <= MAX_CODE_LENGTH; length += 1) {
		const count = counts[length] ?? 0;
		if (code + count > 1 << length) {
			// A table that hands out a code twice is turned away here; the reference leaves the reading of
			// the payload to the platform, which refuses the same stream.
			throw invalidPicture("A Huffman table of the stream stands overfull");
		}
		firstCode[length] = code;
		symbolAt[length] = index;
		largest[length] = count > 0 ? code + count - 1 : -1;
		code = (code + count) << 1;
		index += count;
	}
	const values = new Uint8Array(symbols);
	for (let step = 0; step < symbols; step += 1) {
		values[step] = body[at + MAX_CODE_LENGTH + step] ?? 0;
	}
	return { firstCode, symbolAt, largest, symbols: values };
}

/** Reads a quantisation table, which the stream may store as eight or sixteen bit multiples. */
function readQuantTable(
	body: Buffer,
	at: number,
	tables: (Int32Array | undefined)[],
): number {
	if (at >= body.length)
		throw invalidPicture("A quantisation table stands short of it");
	const head = body[at] ?? 0;
	const precision = head >> 4;
	const id = head & 0x0f;
	if (id >= QUANT_TABLE_COUNT) {
		throw invalidPicture("A quantisation table of the stream carries no name");
	}
	if (0 !== precision && 1 !== precision) {
		throw invalidPicture(
			"A quantisation table of the stream carries no widths",
		);
	}
	const width = 0 === precision ? 1 : 2;
	if (at + 1 + BLOCK_SIZE * width > body.length) {
		throw invalidPicture("A quantisation table stands short of its multiples");
	}
	const table = new Int32Array(BLOCK_SIZE);
	for (let step = 0; step < BLOCK_SIZE; step += 1) {
		const value =
			1 === width
				? (body[at + 1 + step] ?? 0)
				: body.readUInt16BE(at + 1 + step * 2);
		table[ZIGZAG[step] ?? 0] = value;
	}
	tables[id] = table;
	return 1 + BLOCK_SIZE * width;
}

/** Reads a frame head, which names the box of the picture, its components and their sampling. */
function readFrame(body: Buffer): {
	width: number;
	height: number;
	components: {
		id: number;
		horizontal: number;
		vertical: number;
		quant: number;
	}[];
} {
	if (body.length < 6)
		throw invalidPicture("A frame head of the stream stands short of it");
	const bits = body[0] ?? 0;
	if (BITS_PER_SAMPLE !== bits) {
		throw unsupportedPicture(
			"A frame of the stream carries widths this reader does not read",
		);
	}
	const height = body.readUInt16BE(1);
	const width = body.readUInt16BE(3);
	const count = body[5] ?? 0;
	if (0 === width || 0 === height) {
		throw invalidPicture("A frame of the stream names no places of its own");
	}
	if (count < 1 || count > MAX_COMPONENTS) {
		throw invalidPicture("A frame of the stream names no places of a colour");
	}
	if (1 !== count && 3 !== count) {
		throw unsupportedPicture(
			"A frame of the stream names a count of places of a colour this reader does not read",
		);
	}
	if (body.length < 6 + count * 3) {
		throw invalidPicture("The components of a frame stand short of it");
	}
	const components: {
		id: number;
		horizontal: number;
		vertical: number;
		quant: number;
	}[] = [];
	for (let index = 0; index < count; index += 1) {
		const at = 6 + index * 3;
		const horizontal = (body[at + 1] ?? 0) >> 4;
		const vertical = (body[at + 1] ?? 0) & 0x0f;
		if (0 === horizontal || 0 === vertical) {
			throw invalidPicture(
				"A component of the frame samples no places of its own",
			);
		}
		const quant = body[at + 2] ?? 0;
		if (quant >= QUANT_TABLE_COUNT) {
			throw invalidPicture(
				"A component of the frame names no table of multiples",
			);
		}
		components.push({
			id: body[at] ?? 0,
			horizontal,
			vertical,
			quant,
		});
	}
	return { width, height, components };
}

/** Walks the markers up to the coded data and builds the components they describe. */
function parseStream(data: Buffer): Scan {
	if (data.length < 2 || MARKER_PREFIX !== data[0] || SOI !== data[1]) {
		throw invalidPicture("Not a stream of the format");
	}
	const quantTables: (Int32Array | undefined)[] = [];
	const dcTables: (HuffmanTable | undefined)[] = [];
	const acTables: (HuffmanTable | undefined)[] = [];
	let frame:
		| {
				width: number;
				height: number;
				components: {
					id: number;
					horizontal: number;
					vertical: number;
					quant: number;
				}[];
		  }
		| undefined;
	let restartInterval = 0;
	let transform: number | undefined;
	let position = 2;
	while (position + 1 < data.length) {
		if (MARKER_PREFIX !== data[position]) {
			throw invalidPicture("The marker walk of the stream stands out of step");
		}
		while (position < data.length && MARKER_PREFIX === data[position])
			position += 1;
		if (position >= data.length) {
			throw invalidPicture("The marker walk of the stream runs past its end");
		}
		const marker = data[position] ?? 0;
		position += 1;
		if (EOI === marker) throw invalidPicture("The stream carries no picture");
		if (marker >= RST0 && marker <= RST0 + 7) continue;
		if (position + 2 > data.length) {
			throw invalidPicture("A length of the stream stands short of it");
		}
		const length = data.readUInt16BE(position);
		if (length < 2 || position + length > data.length) {
			throw invalidPicture("A length of the stream stands over its end");
		}
		const body = data.subarray(position + 2, position + length);
		if (SOF0 === marker || SOF1 === marker) {
			frame = readFrame(body);
		} else if (
			SOF2 === marker ||
			(marker >= SOF3 && marker <= 0xcf && marker !== DHT)
		) {
			throw unsupportedPicture(
				"A frame of the stream follows a walk this reader does not read",
			);
		} else if (DQT === marker) {
			let at = 0;
			while (at < body.length) at += readQuantTable(body, at, quantTables);
		} else if (DHT === marker) {
			let at = 0;
			while (at < body.length) {
				const head = body[at] ?? 0;
				const kind = head >> 4;
				const id = head & 0x0f;
				if (id >= HUFFMAN_TABLE_COUNT || (0 !== kind && 1 !== kind)) {
					throw invalidPicture("A Huffman table of the stream carries no name");
				}
				const table = readHuffmanTable(body, at + 1);
				if (0 === kind) dcTables[id] = table;
				else acTables[id] = table;
				at += 1 + MAX_CODE_LENGTH + table.symbols.length;
			}
		} else if (DRI === marker) {
			if (body.length < 2)
				throw invalidPicture("A restart interval stands short of it");
			restartInterval = body.readUInt16BE(0);
		} else if (APP14 === marker && body.length > ADOBE_TRANSFORM_AT) {
			transform = body[ADOBE_TRANSFORM_AT] ?? 0;
		} else if (SOS === marker) {
			if (!frame)
				throw invalidPicture("The stream names its scan before its frame");
			const scan = buildScan(frame, body, {
				quantTables,
				dcTables,
				acTables,
				transform,
				restartInterval,
			});
			return {
				frame: scan,
				position: position + length,
				restartInterval,
			};
		}
		position += length;
	}
	throw invalidPicture("The stream carries no scan");
}

/** Builds the components of a frame from the scan that names their coding tables. */
function buildScan(
	frame: {
		width: number;
		height: number;
		components: {
			id: number;
			horizontal: number;
			vertical: number;
			quant: number;
		}[];
	},
	body: Buffer,
	tables: {
		quantTables: (Int32Array | undefined)[];
		dcTables: (HuffmanTable | undefined)[];
		acTables: (HuffmanTable | undefined)[];
		transform: number | undefined;
		restartInterval: number;
	},
): Frame {
	const count = body[0] ?? 0;
	if (count !== frame.components.length) {
		throw unsupportedPicture(
			"A scan of the stream names a part of the places of a colour of its frame",
		);
	}
	if (body.length < 1 + count * 2 + 3) {
		throw invalidPicture("A scan of the stream stands short of it");
	}
	// A sequential scan covers every coefficient of its blocks; a narrower span is a walk this reader does
	// not follow.
	if (0 !== (body[1 + count * 2] ?? 0) || 63 !== (body[2 + count * 2] ?? 0)) {
		throw unsupportedPicture(
			"A scan of the stream covers a part of the places of a block",
		);
	}
	if (0 !== (body[3 + count * 2] ?? 0)) {
		throw unsupportedPicture(
			"A scan of the stream carries a refinement this reader does not read",
		);
	}
	let maxHorizontal = 1;
	let maxVertical = 1;
	for (const component of frame.components) {
		maxHorizontal = Math.max(maxHorizontal, component.horizontal);
		maxVertical = Math.max(maxVertical, component.vertical);
	}
	const mcusPerLine = Math.ceil(frame.width / (BLOCK_DIM * maxHorizontal));
	const mcusPerColumn = Math.ceil(frame.height / (BLOCK_DIM * maxVertical));
	const components: Component[] = [];
	for (let index = 0; index < count; index += 1) {
		const description = frame.components[index];
		if (!description)
			throw invalidPicture("A component of the frame stands out of it");
		const id = body[1 + index * 2] ?? 0;
		if (id !== description.id) {
			throw invalidPicture(
				"A scan of the stream names a component of no frame",
			);
		}
		const selector = body[2 + index * 2] ?? 0;
		const dc = tables.dcTables[selector >> 4];
		const ac = tables.acTables[selector & 0x0f];
		const quant = tables.quantTables[description.quant];
		if (!dc || !ac || !quant) {
			throw invalidPicture(
				"A scan of the stream names a table that stands nowhere",
			);
		}
		const blocksPerLine = mcusPerLine * description.horizontal;
		const blocksPerColumn = mcusPerColumn * description.vertical;
		const stride = blocksPerLine * BLOCK_DIM;
		components.push({
			id,
			horizontal: description.horizontal,
			vertical: description.vertical,
			quant,
			dc,
			ac,
			blocksPerLine,
			blocksPerColumn,
			stride,
			samples: new Uint8Array(stride * blocksPerColumn * BLOCK_DIM),
			predictor: 0,
		});
	}
	return {
		width: frame.width,
		height: frame.height,
		maxHorizontal,
		maxVertical,
		mcusPerLine,
		mcusPerColumn,
		components,
		transform: tables.transform,
	};
}

/**
 * Reads the coded bits of a scan, most significant bit first. A byte of `0xff` inside the coded data is
 * followed by a zero byte; any other byte behind it is a marker, which ends the coded data and is left for
 * the caller.
 */
class JpegBitReader {
	private cache = 0;
	private bits = 0;
	private marker = 0;
	private markerAt = 0;
	position: number;

	constructor(
		private readonly data: Buffer,
		from: number,
	) {
		this.position = from;
	}

	/** The marker that ended the coded data, or zero when none was seen yet. */
	peekMarker(): number {
		return this.marker;
	}

	/** Takes the marker that ends the coded data, which stands at the reader's place. */
	takeMarker(): number {
		if (0 === this.marker) {
			throw invalidPicture(
				"The coded data of the stream ends without a marker",
			);
		}
		const marker = this.marker;
		this.marker = 0;
		this.position = this.markerAt + 2;
		this.bits = 0;
		return marker;
	}

	readBit(): number {
		if (0 === this.bits) {
			if (this.position >= this.data.length) {
				throw invalidPicture("The coded data of the stream runs past its end");
			}
			const byte = this.data[this.position] ?? 0;
			const at = this.position;
			this.position += 1;
			if (MARKER_PREFIX === byte) {
				const next = this.data[this.position] ?? 0;
				if (STUFFED_BYTE !== next) {
					this.marker = (MARKER_PREFIX << 8) | next;
					this.markerAt = at;
					throw invalidPicture(
						"A marker of the stream stands inside the coded data",
					);
				}
				// A byte of `0xff` inside the coded data stands as itself, followed by a zero byte.
				this.position += 1;
				this.cache = MARKER_PREFIX;
			} else {
				this.cache = byte;
			}
			this.bits = 8;
		}
		this.bits -= 1;
		return (this.cache >> this.bits) & 1;
	}

	readBits(count: number): number {
		let value = 0;
		for (let index = 0; index < count; index += 1) {
			value = (value << 1) | this.readBit();
		}
		return value;
	}

	/** Drops the bits left in the last byte of an interval and reads the marker that follows it. */
	expectRestart(): number {
		this.bits = 0;
		if (0 !== this.marker) return this.takeMarker();
		if (
			this.position + 1 >= this.data.length ||
			MARKER_PREFIX !== this.data[this.position]
		) {
			throw invalidPicture(
				"The stream carries no restart marker where it names one",
			);
		}
		const marker = (MARKER_PREFIX << 8) | (this.data[this.position + 1] ?? 0);
		this.position += 2;
		return marker;
	}
}

function decodeHuffman(reader: JpegBitReader, table: HuffmanTable): number {
	let code = reader.readBit();
	let length = 1;
	while (length <= MAX_CODE_LENGTH && code > (table.largest[length] ?? -1)) {
		code = (code << 1) | reader.readBit();
		length += 1;
	}
	if (length > MAX_CODE_LENGTH) {
		throw invalidPicture("A code of the stream stands in no table");
	}
	const at =
		(table.symbolAt[length] ?? 0) + code - (table.firstCode[length] ?? 0);
	const symbol = table.symbols[at];
	if (undefined === symbol) {
		throw invalidPicture("A code of the stream stands out of its table");
	}
	return symbol;
}

/** Reads a coefficient of `count` bits, which stands as a signed value of that width. */
function receiveExtend(reader: JpegBitReader, count: number): number {
	const value = reader.readBits(count);
	if (count > 0 && value < 1 << (count - 1)) return value - ((1 << count) - 1);
	return value;
}

/** Reads one block of coefficients, undoes its quantisation and lays its samples into the component. */
const BLOCK = new Float64Array(BLOCK_SIZE);
const ROW = new Float64Array(BLOCK_SIZE);

function decodeBlock(
	reader: JpegBitReader,
	component: Component,
	blockRow: number,
	blockColumn: number,
): void {
	for (let index = 0; index < BLOCK_SIZE; index += 1) BLOCK[index] = 0;
	const direct = decodeHuffman(reader, component.dc);
	component.predictor += direct > 0 ? receiveExtend(reader, direct) : 0;
	BLOCK[0] = component.predictor * (component.quant[0] ?? 0);
	let step = 1;
	while (step < BLOCK_SIZE) {
		const symbol = decodeHuffman(reader, component.ac);
		const run = symbol >> 4;
		const width = symbol & 0x0f;
		if (0 === width) {
			if (15 !== run) break;
			step += 16;
			continue;
		}
		step += run;
		if (step >= BLOCK_SIZE) {
			throw invalidPicture("A block of the stream runs past its end");
		}
		const at = ZIGZAG[step] ?? 0;
		BLOCK[at] = receiveExtend(reader, width) * (component.quant[at] ?? 0);
		step += 1;
	}
	// The inverse transform, a pass over the rows and then a pass over the columns.
	for (let frequency = 0; frequency < BLOCK_DIM; frequency += 1) {
		for (let place = 0; place < BLOCK_DIM; place += 1) {
			let sum = 0;
			for (let index = 0; index < BLOCK_DIM; index += 1) {
				sum +=
					(COSINE[place * BLOCK_DIM + index] ?? 0) *
					(BLOCK[frequency * BLOCK_DIM + index] ?? 0);
			}
			ROW[frequency * BLOCK_DIM + place] = sum;
		}
	}
	for (let row = 0; row < BLOCK_DIM; row += 1) {
		const target =
			(blockRow * BLOCK_DIM + row) * component.stride + blockColumn * BLOCK_DIM;
		for (let place = 0; place < BLOCK_DIM; place += 1) {
			let sum = 0;
			for (let index = 0; index < BLOCK_DIM; index += 1) {
				sum +=
					(COSINE[row * BLOCK_DIM + index] ?? 0) *
					(ROW[index * BLOCK_DIM + place] ?? 0);
			}
			const value = Math.round(sum) + LEVEL_SHIFT;
			component.samples[target + place] =
				value < 0 ? 0 : value > 255 ? 255 : value;
		}
	}
}

/** Reads the coded data of a scan into the samples of its components. */
function decodeScan(data: Buffer, scan: Scan): void {
	const { frame, restartInterval } = scan;
	const reader = new JpegBitReader(data, scan.position);
	const limit = frame.mcusPerLine * frame.mcusPerColumn;
	let done = 0;
	for (let row = 0; row < frame.mcusPerColumn; row += 1) {
		for (let column = 0; column < frame.mcusPerLine; column += 1) {
			for (const component of frame.components) {
				for (let down = 0; down < component.vertical; down += 1) {
					for (let across = 0; across < component.horizontal; across += 1) {
						decodeBlock(
							reader,
							component,
							row * component.vertical + down,
							column * component.horizontal + across,
						);
					}
				}
			}
			done += 1;
			if (restartInterval > 0 && done < limit && 0 === done % restartInterval) {
				const marker = reader.expectRestart();
				if (marker < RESTART_FIRST || marker > RESTART_LAST) {
					throw invalidPicture(
						"The stream carries no restart marker where it names one",
					);
				}
				for (const component of frame.components) component.predictor = 0;
			}
		}
	}
}

/** One component of the picture, laid out at its full size. */
interface Plane {
	/** The width of one row of the plane. */
	stride: number;
	samples: Uint8Array;
}

/** A sample of a component, with the place clamped to the samples the component holds. */
function sampleAt(component: Component, x: number, y: number): number {
	const rows = component.blocksPerColumn * BLOCK_DIM;
	const at = y < 0 ? 0 : y >= rows ? rows - 1 : y;
	const place = x < 0 ? 0 : x >= component.stride ? component.stride - 1 : x;
	return component.samples[at * component.stride + place] ?? 0;
}

/** The width, in samples, of a component of a picture of the given width. */
function sourceWidth(
	component: Component,
	frame: Frame,
	width: number,
): number {
	return Math.ceil((width * component.horizontal) / frame.maxHorizontal);
}

/**
 * Lays a component out at the full size of the picture. A component that samples the picture twice as
 * coarsely across widens each pair of places from the nearest two samples, three quarters of the nearer
 * one and a quarter of the further one; a component that also samples twice as coarsely down does the same
 * between the rows on either side of each one. Any other spacing widens by repeating the nearest sample.
 *
 * The reference decodes through the platform, whose own widening is the one above for the common spacings,
 * so the two agree except for the rounding at the edges of a colour change.
 */
function upsampleComponent(
	component: Component,
	frame: Frame,
	width: number,
): Plane {
	const across = frame.maxHorizontal / component.horizontal;
	const down = frame.maxVertical / component.vertical;
	const source = sourceWidth(component, frame, width);
	const rows = component.blocksPerColumn * BLOCK_DIM;
	const stride = component.stride * across;
	const samples = new Uint8Array(stride * rows * down);
	if (1 === across && 1 === down) {
		for (let row = 0; row < rows; row += 1) {
			const from = row * component.stride;
			samples.set(
				component.samples.subarray(from, from + stride),
				row * stride,
			);
		}
	} else if (2 === across) {
		// Two output rows come from each pair of rows of the component when it also samples down.
		const step = 2 === down ? 2 : 1;
		for (let row = 0; row < rows; row += 1) {
			for (let down2 = 0; down2 < step; down2 += 1) {
				const target = (row * step + down2) * stride;
				if (2 === down) {
					const above = sampleAt(component, 0, row - 1);
					const below = sampleAt(component, 0, row + 1);
					const near = 0 === down2 ? above : below;
					let last = sampleAt(component, 0, row) * 3 + near;
					let current = sampleAt(component, 1, row) * 3 + near;
					samples[target] = (last * 4 + 8) >> 4;
					samples[target + 1] = (last * 3 + current + 7) >> 4;
					let previous = last;
					last = current;
					for (let place = 1; place < source - 1; place += 1) {
						current = sampleAt(component, place + 1, row) * 3 + near;
						samples[target + place * 2] = (last * 3 + previous + 8) >> 4;
						samples[target + place * 2 + 1] = (last * 3 + current + 7) >> 4;
						previous = last;
						last = current;
					}
					samples[target + (source - 1) * 2] = (last * 3 + previous + 8) >> 4;
					samples[target + (source - 1) * 2 + 1] = (last * 4 + 7) >> 4;
				} else {
					samples[target] = sampleAt(component, 0, row);
					samples[target + 1] =
						(sampleAt(component, 0, row) * 3 +
							sampleAt(component, 1, row) +
							2) >>
						2;
					for (let place = 1; place < source - 1; place += 1) {
						const value = sampleAt(component, place, row) * 3;
						samples[target + place * 2] =
							(value + sampleAt(component, place - 1, row) + 1) >> 2;
						samples[target + place * 2 + 1] =
							(value + sampleAt(component, place + 1, row) + 2) >> 2;
					}
					samples[target + (source - 1) * 2] =
						(sampleAt(component, source - 1, row) * 3 +
							sampleAt(component, source - 2, row) +
							1) >>
						2;
					samples[target + (source - 1) * 2 + 1] = sampleAt(
						component,
						source - 1,
						row,
					);
				}
			}
		}
	} else {
		for (let row = 0; row < rows * down; row += 1) {
			const from = Math.trunc(row / down);
			const target = row * stride;
			for (let place = 0; place < stride; place += 1) {
				samples[target + place] = sampleAt(
					component,
					Math.trunc(place / across),
					from,
				);
			}
		}
	}
	return { stride, samples };
}

function clampColour(value: number): number {
	return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

/**
 * Reads a JPEG stream and returns its places as a picture of four places a pixel, blue first. A stream
 * this reader does not follow is turned away.
 */
export function readJpegImage(data: Buffer): JpegImage {
	const scan = parseStream(data);
	decodeScan(data, scan);
	const { frame } = scan;
	const { width, height } = frame;
	for (const component of frame.components) {
		if (
			0 !== frame.maxHorizontal % component.horizontal ||
			0 !== frame.maxVertical % component.vertical
		) {
			throw unsupportedPicture(
				"A component of the stream samples a part of a place of a colour",
			);
		}
	}
	const planes = frame.components.map((component) =>
		upsampleComponent(component, frame, width),
	);
	const pixels = Buffer.alloc(width * height * PLACES_ALPHA);
	const first = planes[0];
	const second = planes[1];
	const third = planes[2];
	if (!first)
		throw invalidPicture("The frame of the stream carries no picture");
	const direct =
		undefined !== second && undefined !== third && 0 === (frame.transform ?? 1);
	const read = (plane: Plane, x: number, y: number): number =>
		plane.samples[y * plane.stride + x] ?? 0;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const at = (y * width + x) * PLACES_ALPHA;
			if (!second || !third) {
				const grey = read(first, x, y);
				pixels[at] = grey;
				pixels[at + 1] = grey;
				pixels[at + 2] = grey;
			} else if (direct) {
				pixels[at] = read(third, x, y);
				pixels[at + 1] = read(second, x, y);
				pixels[at + 2] = read(first, x, y);
			} else {
				const luma = read(first, x, y);
				const blue = read(second, x, y) - LEVEL_SHIFT;
				const red = read(third, x, y) - LEVEL_SHIFT;
				pixels[at] = clampColour(luma + 1.772 * blue);
				pixels[at + 1] = clampColour(luma - 0.344136 * blue - 0.714136 * red);
				pixels[at + 2] = clampColour(luma + 1.402 * red);
			}
			pixels[at + 3] = FULL_ALPHA;
		}
	}
	return { width, height, bitsPerPixel: 32, pixels };
}
