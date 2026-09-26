// A reader of the JPEG interchange format, used by the GARbro formats whose payload is a JPEG that the
// reference hands to the platform decoder of the Windows imaging stack. The reference keeps no algorithm
// for such a payload, so this is a reader of the format itself rather than a port: the layout below follows
// ITU-T T.81 (JPEG), baseline sequential DCT, eight bits a sample.
//
// Read here: SOF0, SOF1 and SOF2 frames of one or three components with Huffman coding, quantisation tables
// of eight or sixteen bits, restart intervals, and the Adobe colour transform marker. A baseline frame
// carries one scan that covers every coefficient of every block; a progressive frame arrives over several
// scans, each covering a band of the coefficients of one component, with the bits below the band added by a
// refinement of it. The coefficients of all the scans are joined into the blocks of the components as they
// come, and the blocks are laid out once the stream has been read. Turned away as an unsupported feature:
// any other frame kind, which is an arithmetic coded or an otherwise unread stream, a frame of four or more
// components, and a frame of twelve bits a sample. Turned away as an invalid stream: a broken marker walk, a
// broken Huffman table, a restart marker that is missing or out of range, a scan that joins the places
// behind the first of a block, and a coefficient that runs past the band of its scan.
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
	/** The number of the quantisation table of the component, which is read when the blocks are laid out. */
	quantIndex: number;
	/** The blocks of the component, in the order the stream carries them, sixty four coefficients each. */
	coefficients: Int32Array;
	/** The blocks of the component within the groups of its frame. */
	blocksPerLine: number;
	blocksPerColumn: number;
	/** The blocks of the component within its own size, which a scan of one component alone walks. */
	ownBlocksPerLine: number;
	ownBlocksPerColumn: number;
	/** The width of one row of samples of this component. */
	stride: number;
	samples: Uint8Array;
	/** The running sum of the direct current coefficients, which a scan and a restart marker clear. */
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
	/** The quantisation tables the stream has declared, which the blocks are read against at the end. */
	quantTables: (Int32Array | undefined)[];
	/** Whether the frame arrives over several scans, each covering a part of the coefficients. */
	progressive: boolean;
	/** One when the components are a luminance and two chrominance places, zero when they are red, green
	 * and blue; undefined when the stream carries no Adobe marker. */
	transform: number | undefined;
}

/** One component of a scan, with the tables that scan reads it through. */
interface ScanComponent {
	component: Component;
	dc: HuffmanTable | undefined;
	ac: HuffmanTable | undefined;
}

/** The head of a scan: which components it holds, which coefficients of them, and where it starts. */
interface ScanHead {
	/** The place of the first byte of the coded data. */
	position: number;
	components: ScanComponent[];
	/** The first coefficient of the scan, and the last. */
	from: number;
	to: number;
	/** The bits the coefficients of this scan start at, and the bits a refinement of them adds. */
	high: number;
	low: number;
	restartInterval: number;
	/** Whether the scan walks the groups of the frame or the blocks of one component alone. */
	interleaved: boolean;
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

/**
 * Reads the coded bits of a scan, most significant bit first. A byte of `0xff` inside the coded data is
 * followed by a zero byte; any other byte behind it is a marker, which ends the coded data.
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

	/**
	 * The place of the marker that follows the coded data, which the marker walk behind this one continues
	 * from. The bits left in the last byte are dropped, and a stream that ends without a marker reports its
	 * own end, which ends the walk.
	 */
	endOfScan(): number {
		this.bits = 0;
		if (0 !== this.marker) return this.markerAt;
		let at = this.position;
		while (at + 1 < this.data.length) {
			if (
				MARKER_PREFIX === this.data[at] &&
				STUFFED_BYTE !== this.data[at + 1]
			) {
				return at;
			}
			at += 1;
		}
		return this.data.length;
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

/**
 * Builds the components of a frame, their blocks and the tables they are read against. A scan of one
 * component alone walks that component's own blocks, which are fewer than the blocks of the groups when the
 * component samples the picture more coarsely than the frame: the blocks behind the component's own edge are
 * carried by the joined scans and stand empty in a scan of the component alone.
 */
function buildFrame(
	description: {
		width: number;
		height: number;
		components: {
			id: number;
			horizontal: number;
			vertical: number;
			quant: number;
		}[];
	},
	progressive: boolean,
	quantTables: (Int32Array | undefined)[],
): Frame {
	let maxHorizontal = 1;
	let maxVertical = 1;
	for (const component of description.components) {
		maxHorizontal = Math.max(maxHorizontal, component.horizontal);
		maxVertical = Math.max(maxVertical, component.vertical);
	}
	const mcusPerLine = Math.ceil(
		description.width / (BLOCK_DIM * maxHorizontal),
	);
	const mcusPerColumn = Math.ceil(
		description.height / (BLOCK_DIM * maxVertical),
	);
	const components: Component[] = [];
	for (const entry of description.components) {
		const blocksPerLine = mcusPerLine * entry.horizontal;
		const blocksPerColumn = mcusPerColumn * entry.vertical;
		const ownBlocksPerLine = Math.ceil(
			Math.ceil((description.width * entry.horizontal) / maxHorizontal) /
				BLOCK_DIM,
		);
		const ownBlocksPerColumn = Math.ceil(
			Math.ceil((description.height * entry.vertical) / maxVertical) /
				BLOCK_DIM,
		);
		const stride = blocksPerLine * BLOCK_DIM;
		components.push({
			id: entry.id,
			horizontal: entry.horizontal,
			vertical: entry.vertical,
			quantIndex: entry.quant,
			coefficients: new Int32Array(
				blocksPerLine * blocksPerColumn * BLOCK_SIZE,
			),
			blocksPerLine,
			blocksPerColumn,
			ownBlocksPerLine,
			ownBlocksPerColumn,
			stride,
			samples: new Uint8Array(stride * blocksPerColumn * BLOCK_DIM),
			predictor: 0,
		});
	}
	return {
		width: description.width,
		height: description.height,
		maxHorizontal,
		maxVertical,
		mcusPerLine,
		mcusPerColumn,
		components,
		quantTables,
		progressive,
		transform: undefined,
	};
}

/**
 * Reads the head of a scan: the components it holds and the tables it reads them through, the coefficients
 * it covers and the bits of them it carries. A scan of a frame of several components covers the direct
 * current coefficient of each of them alone; a scan that covers the other coefficients names one component.
 */
function readScanHead(
	frame: Frame,
	body: Buffer,
	tables: {
		dcTables: (HuffmanTable | undefined)[];
		acTables: (HuffmanTable | undefined)[];
		restartInterval: number;
	},
	position: number,
): ScanHead {
	const count = body[0] ?? 0;
	if (count < 1 || count > frame.components.length) {
		throw invalidPicture(
			"A scan of the stream names a count of places of a colour its frame does not hold",
		);
	}
	if (body.length < 1 + count * 2 + 3) {
		throw invalidPicture("A scan of the stream stands short of it");
	}
	const from = body[1 + count * 2] ?? 0;
	const to = body[2 + count * 2] ?? 0;
	const approximation = body[3 + count * 2] ?? 0;
	const high = approximation >> 4;
	const low = approximation & 0x0f;
	if (to > 63 || from > to) {
		throw invalidPicture("A scan of the stream covers no places of a block");
	}
	if (0 !== high && high !== low + 1) {
		throw invalidPicture(
			"A scan of the stream refines places of no scan before it",
		);
	}
	const components: ScanComponent[] = [];
	for (let index = 0; index < count; index += 1) {
		const id = body[1 + index * 2] ?? 0;
		const component = frame.components.find((entry) => entry.id === id);
		if (!component) {
			throw invalidPicture(
				"A scan of the stream names a component of no frame",
			);
		}
		const selector = body[2 + index * 2] ?? 0;
		const dc = tables.dcTables[selector >> 4];
		const ac = tables.acTables[selector & 0x0f];
		// A scan that covers the direct current place needs the table of it, and one that covers the other
		// places needs the table of those.
		if ((0 === from && !dc) || (to > 0 && !ac)) {
			throw invalidPicture(
				"A scan of the stream names a table that stands nowhere",
			);
		}
		components.push({ component, dc, ac });
	}
	const interleaved = count > 1;
	if (interleaved && from > 0) {
		throw invalidPicture(
			"A scan of the stream joins the places behind the first of a block",
		);
	}
	return {
		position,
		components,
		from,
		to,
		high,
		low,
		restartInterval: tables.restartInterval,
		interleaved,
	};
}

/**
 * Reads the coefficients of a scan that covers a band of them, without a refinement. A code that ends the
 * band stands for this block and for as many blocks behind it as it counts, and the count is carried between
 * the blocks of the scan; a block a count covers carries no code of its own.
 */
function decodeAcScan(
	reader: JpegBitReader,
	table: HuffmanTable,
	head: ScanHead,
	block: Int32Array,
	from: number,
	eobRun: number,
): number {
	if (eobRun > 0) return eobRun - 1;
	let step = from;
	while (step <= head.to) {
		const symbol = decodeHuffman(reader, table);
		const run = symbol >> 4;
		const width = symbol & 0x0f;
		if (0 === width) {
			if (15 !== run) {
				// The band ends here, for this block and for the blocks behind it that the code counts. The
				// blocks it covers carry no code of their own, so the count is carried between blocks.
				let span = 1 << run;
				if (run > 0) span += reader.readBits(run);
				return span - 1;
			}
			step += 16;
			continue;
		}
		step += run;
		if (step > head.to) {
			throw invalidPicture(
				"A block of the stream runs past the band of its scan",
			);
		}
		block[ZIGZAG[step] ?? 0] = receiveExtend(reader, width) << head.low;
		step += 1;
	}
	return eobRun - 1;
}

/**
 * Reads the coefficients of a scan that refines a band another scan carried: every coefficient that stands
 * already takes one bit more, and the codes name the places where a coefficient stands for the first time.
 * A code that ends the band stands for this block and for as many blocks behind it as it counts, and the
 * count is carried between the blocks of the scan.
 */
function decodeAcRefinement(
	reader: JpegBitReader,
	table: HuffmanTable,
	head: ScanHead,
	block: Int32Array,
	from: number,
	eobRun: number,
): number {
	const bit = 1 << head.low;
	const negative = -bit;
	let step = from;
	if (0 === eobRun) {
		for (; step <= head.to; step += 1) {
			const symbol = decodeHuffman(reader, table);
			let run = symbol >> 4;
			const width = symbol & 0x0f;
			let value = 0;
			if (0 !== width) {
				if (1 !== width) {
					throw invalidPicture(
						"A coefficient of the stream stands at a width this reader does not read",
					);
				}
				value = reader.readBit() ? bit : negative;
			} else if (15 !== run) {
				// The band ends here, for this block and for the blocks behind it that the code counts.
				eobRun = 1 << run;
				if (run > 0) eobRun += reader.readBits(run);
				break;
			}
			// Walk over the coefficients that stand already, each of them taking a correction bit, and over as
			// many places that stand empty as the code names.
			do {
				const at = ZIGZAG[step] ?? 0;
				const standing = block[at] ?? 0;
				if (0 !== standing) {
					if (reader.readBit() && 0 === (standing & bit)) {
						block[at] = standing + (standing > 0 ? bit : negative);
					}
				} else {
					run -= 1;
					if (run < 0) break;
				}
				step += 1;
			} while (step <= head.to);
			if (0 !== value) {
				if (step > head.to) {
					throw invalidPicture(
						"A block of the stream runs past the band of its scan",
					);
				}
				block[ZIGZAG[step] ?? 0] = value;
			}
		}
	}
	if (eobRun > 0) {
		// The places behind the last coefficient the block named: every coefficient that stands already takes
		// one more correction bit.
		for (; step <= head.to; step += 1) {
			const at = ZIGZAG[step] ?? 0;
			const standing = block[at] ?? 0;
			if (0 === standing) continue;
			if (reader.readBit() && 0 === (standing & bit)) {
				block[at] = standing + (standing > 0 ? bit : negative);
			}
		}
		eobRun -= 1;
	}
	return eobRun;
}

/** Reads one block of a scan into the coefficients of its component. */
function decodeBlock(
	reader: JpegBitReader,
	entry: ScanComponent,
	head: ScanHead,
	component: Component,
	blockRow: number,
	blockColumn: number,
	eobRun: number,
): number {
	const at = (blockRow * component.blocksPerLine + blockColumn) * BLOCK_SIZE;
	const block = component.coefficients.subarray(at, at + BLOCK_SIZE);
	if (0 === head.from) {
		if (0 === head.high) {
			const table = entry.dc;
			if (!table) {
				throw invalidPicture(
					"A scan of the stream names a table that stands nowhere",
				);
			}
			const direct = decodeHuffman(reader, table);
			component.predictor += direct > 0 ? receiveExtend(reader, direct) : 0;
			block[0] = component.predictor << head.low;
		} else if (reader.readBit()) {
			// A refinement of the direct current place: one bit, which stands at the place of the scan.
			block[0] = (block[0] ?? 0) | (1 << head.low);
		}
	}
	if (head.to > 0) {
		const table = entry.ac;
		if (!table) {
			throw invalidPicture(
				"A scan of the stream names a table that stands nowhere",
			);
		}
		const from = 0 === head.from ? 1 : head.from;
		if (0 === head.high) {
			eobRun = decodeAcScan(reader, table, head, block, from, eobRun);
		} else {
			eobRun = decodeAcRefinement(reader, table, head, block, from, eobRun);
		}
	}
	return eobRun;
}

/** Reads the coded data of a scan, and returns the place of the marker that ends it. */
function decodeScan(data: Buffer, frame: Frame, head: ScanHead): number {
	const reader = new JpegBitReader(data, head.position);
	const single = head.components[0]?.component;
	const across = head.interleaved
		? frame.mcusPerLine
		: (single?.ownBlocksPerLine ?? 0);
	const down = head.interleaved
		? frame.mcusPerColumn
		: (single?.ownBlocksPerColumn ?? 0);
	const limit = across * down;
	let done = 0;
	let eobRun = 0;
	for (const entry of head.components) entry.component.predictor = 0;
	for (let row = 0; row < down; row += 1) {
		for (let column = 0; column < across; column += 1) {
			for (const entry of head.components) {
				const { component } = entry;
				if (head.interleaved) {
					for (let down2 = 0; down2 < component.vertical; down2 += 1) {
						for (
							let across2 = 0;
							across2 < component.horizontal;
							across2 += 1
						) {
							eobRun = decodeBlock(
								reader,
								entry,
								head,
								component,
								row * component.vertical + down2,
								column * component.horizontal + across2,
								eobRun,
							);
						}
					}
				} else {
					eobRun = decodeBlock(
						reader,
						entry,
						head,
						component,
						row,
						column,
						eobRun,
					);
				}
			}
			done += 1;
			if (
				head.restartInterval > 0 &&
				done < limit &&
				0 === done % head.restartInterval
			) {
				const marker = reader.expectRestart();
				if (marker < RESTART_FIRST || marker > RESTART_LAST) {
					throw invalidPicture(
						"The stream carries no restart marker where it names one",
					);
				}
				for (const entry of head.components) entry.component.predictor = 0;
				eobRun = 0;
			}
		}
	}
	return reader.endOfScan();
}

/**
 * Walks the markers of a stream and reads every scan of it, which is what a progressive stream needs: its
 * coefficients arrive over several scans and are joined into the blocks of the components as they come. A
 * baseline stream carries one scan, which covers every coefficient of every block of its frame.
 */
function parsePicture(data: Buffer): Frame {
	if (data.length < 2 || MARKER_PREFIX !== data[0] || SOI !== data[1]) {
		throw invalidPicture("Not a stream of the format");
	}
	const quantTables: (Int32Array | undefined)[] = [];
	const dcTables: (HuffmanTable | undefined)[] = [];
	const acTables: (HuffmanTable | undefined)[] = [];
	let frame: Frame | undefined;
	let restartInterval = 0;
	let transform: number | undefined;
	let scans = 0;
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
		if (EOI === marker) break;
		if (marker >= RST0 && marker <= RST0 + 7) continue;
		if (position + 2 > data.length) {
			throw invalidPicture("A length of the stream stands short of it");
		}
		const length = data.readUInt16BE(position);
		if (length < 2 || position + length > data.length) {
			throw invalidPicture("A length of the stream stands over its end");
		}
		const body = data.subarray(position + 2, position + length);
		if (SOF0 === marker || SOF1 === marker || SOF2 === marker) {
			if (frame) throw invalidPicture("The stream names more than one frame");
			frame = buildFrame(readFrame(body), SOF2 === marker, quantTables);
		} else if (marker >= SOF3 && marker <= 0xcf && marker !== DHT) {
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
			frame.transform = transform;
			const head = readScanHead(
				frame,
				body,
				{ dcTables, acTables, restartInterval },
				position + length,
			);
			position = decodeScan(data, frame, head);
			scans += 1;
			continue;
		}
		position += length;
	}
	if (!frame) throw invalidPicture("The stream carries no frame");
	if (0 === scans) throw invalidPicture("The stream carries no scan");
	frame.transform = transform;
	return frame;
}

/** The block a component's samples are laid out from, and the row the inverse transform walks. */
const BLOCK = new Float64Array(BLOCK_SIZE);
const ROW = new Float64Array(BLOCK_SIZE);

/** The inverse transform of one block of a component: a pass over the rows, then a pass over the columns. */
function transformBlock(
	component: Component,
	blockRow: number,
	blockColumn: number,
): void {
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

/**
 * Undoes the quantisation of every block of a component and lays its samples out. A block the stream never
 * carried stands at nothing, which the level shift turns into the middle of the range.
 */
function transformComponent(frame: Frame, component: Component): void {
	const quant = frame.quantTables[component.quantIndex];
	if (!quant) {
		throw invalidPicture(
			"A component of the frame names a table of multiples that stands nowhere",
		);
	}
	for (let blockRow = 0; blockRow < component.blocksPerColumn; blockRow += 1) {
		for (
			let blockColumn = 0;
			blockColumn < component.blocksPerLine;
			blockColumn += 1
		) {
			const at =
				(blockRow * component.blocksPerLine + blockColumn) * BLOCK_SIZE;
			for (let index = 0; index < BLOCK_SIZE; index += 1) {
				BLOCK[index] =
					(component.coefficients[at + index] ?? 0) * (quant[index] ?? 0);
			}
			transformBlock(component, blockRow, blockColumn);
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
	const frame = parsePicture(data);
	for (const component of frame.components) {
		transformComponent(frame, component);
	}
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
