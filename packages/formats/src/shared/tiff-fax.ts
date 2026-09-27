// Reader of the walks of the fax of the tagged image file format (the counts of the head of the format of the fax
// of the two places of the file of the counts of the head of the picture, T.4, and the counts of the two places of
// the file, T.6). The reference stands its platform over such a file (`GameRes/ImageTIFF.cs` of GARbro hands the
// stream to `TiffBitmapDecoder` of WPF), so this module walks the counts of the fax itself. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The counts of the places of a row stand of the counts of the head of the fax: a count of the places of a colour
// of the picture (white) and a count of the places of the colour of the other (black) stand one behind the other,
// and the count of one place of the file a place of the picture stands for the place of the colour of the picture
// (the dark place), which the walk of the picture of the file stands of the counts of its own head.
//
// Read here: the counts of the head of the format of the fax of one place of the file (group 3 of the format, of the
// counts of the head of the format of the fax, of one place of the file a place of the picture and of the two places
// of the file as well) and the counts of the two places of the file (group 4 of the format, T.6). Both walks read
// the counts of the head of the format of the fax alone: the count of the head of the format of the fax of the
// counts of the places of the file of the picture itself stands turned away, which the record names. The walk of
// the counts of the head of the format of the fax of the two places of the file follows the walk of the library of
// the counts of the head of the format of the fax of the picture of this machine, of the counts of the head of the
// format of the fax of the format (libtiff, of the counts of the head of the format of the fax of the picture of
// Frank Cringle), of the counts of the head of the format of the fax of the picture of the format itself.

import { GarbroError } from "@garbro-mcp/core";

/** The counts of the head of the format of the fax of the counts of the places of the file of a colour of the
 * picture: a count of the head, of the count of the places of the file it stands for and of the count of the
 * places of the file of the count of the head. */
type RunCode = readonly [number, number, number];

/** The counts of the head of the format of the fax of the counts of the places of the file of the colour of the
 * picture, of the counts of the head of the format of the fax of the two places of the file and of group 4. */
const WHITE_RUNS: readonly RunCode[] = [
	[0, 0b00110101, 8],
	[1, 0b000111, 6],
	[2, 0b0111, 4],
	[3, 0b1000, 4],
	[4, 0b1011, 4],
	[5, 0b1100, 4],
	[6, 0b1110, 4],
	[7, 0b1111, 4],
	[8, 0b10011, 5],
	[9, 0b10100, 5],
	[10, 0b00111, 5],
	[11, 0b01000, 5],
	[12, 0b001000, 6],
	[13, 0b000011, 6],
	[14, 0b110100, 6],
	[15, 0b110101, 6],
	[16, 0b101010, 6],
	[17, 0b101011, 6],
	[18, 0b0100111, 7],
	[19, 0b0001100, 7],
	[20, 0b0001000, 7],
	[21, 0b0010111, 7],
	[22, 0b0000011, 7],
	[23, 0b0000100, 7],
	[24, 0b0101000, 7],
	[25, 0b0101011, 7],
	[26, 0b0010011, 7],
	[27, 0b0100100, 7],
	[28, 0b0011000, 7],
	[29, 0b00000010, 8],
	[30, 0b00000011, 8],
	[31, 0b00011010, 8],
	[32, 0b00011011, 8],
	[33, 0b00010010, 8],
	[34, 0b00010011, 8],
	[35, 0b00010100, 8],
	[36, 0b00010101, 8],
	[37, 0b00010110, 8],
	[38, 0b00010111, 8],
	[39, 0b00101000, 8],
	[40, 0b00101001, 8],
	[41, 0b00101010, 8],
	[42, 0b00101011, 8],
	[43, 0b00101100, 8],
	[44, 0b00101101, 8],
	[45, 0b00000100, 8],
	[46, 0b00000101, 8],
	[47, 0b00001010, 8],
	[48, 0b00001011, 8],
	[49, 0b01010010, 8],
	[50, 0b01010011, 8],
	[51, 0b01010100, 8],
	[52, 0b01010101, 8],
	[53, 0b00100100, 8],
	[54, 0b00100101, 8],
	[55, 0b01011000, 8],
	[56, 0b01011001, 8],
	[57, 0b01011010, 8],
	[58, 0b01011011, 8],
	[59, 0b01001010, 8],
	[60, 0b01001011, 8],
	[61, 0b00110010, 8],
	[62, 0b00110011, 8],
	[63, 0b00110100, 8],
	[64, 0b11011, 5],
	[128, 0b10010, 5],
	[192, 0b010111, 6],
	[256, 0b0110111, 7],
	[320, 0b00110110, 8],
	[384, 0b00110111, 8],
	[448, 0b01100100, 8],
	[512, 0b01100101, 8],
	[576, 0b01101000, 8],
	[640, 0b01100111, 8],
	[704, 0b011001100, 9],
	[768, 0b011001101, 9],
	[832, 0b011010010, 9],
	[896, 0b011010011, 9],
	[960, 0b011010100, 9],
	[1024, 0b011010101, 9],
	[1088, 0b011010110, 9],
	[1152, 0b011010111, 9],
	[1216, 0b011011000, 9],
	[1280, 0b011011001, 9],
	[1344, 0b011011010, 9],
	[1408, 0b011011011, 9],
	[1472, 0b010011000, 9],
	[1536, 0b010011001, 9],
	[1600, 0b010011010, 9],
	[1664, 0b011000, 6],
	[1728, 0b010011011, 9],
];

/** The counts of the head of the format of the fax of the counts of the places of the file of the colour of the
 * picture of the other (black). */
const BLACK_RUNS: readonly RunCode[] = [
	[0, 0b0000110111, 10],
	[1, 0b010, 3],
	[2, 0b11, 2],
	[3, 0b10, 2],
	[4, 0b011, 3],
	[5, 0b0011, 4],
	[6, 0b0010, 4],
	[7, 0b00011, 5],
	[8, 0b000101, 6],
	[9, 0b000100, 6],
	[10, 0b0000100, 7],
	[11, 0b0000101, 7],
	[12, 0b0000111, 7],
	[13, 0b00000100, 8],
	[14, 0b00000111, 8],
	[15, 0b000011000, 9],
	[16, 0b0000010111, 10],
	[17, 0b0000011000, 10],
	[18, 0b0000001000, 10],
	[19, 0b00001100111, 11],
	[20, 0b00001101000, 11],
	[21, 0b00001101100, 11],
	[22, 0b00000110111, 11],
	[23, 0b00000101000, 11],
	[24, 0b00000010111, 11],
	[25, 0b00000011000, 11],
	[26, 0b000011001010, 12],
	[27, 0b000011001011, 12],
	[28, 0b000011001100, 12],
	[29, 0b000011001101, 12],
	[30, 0b000001101000, 12],
	[31, 0b000001101001, 12],
	[32, 0b000001101010, 12],
	[33, 0b000001101011, 12],
	[34, 0b000011010010, 12],
	[35, 0b000011010011, 12],
	[36, 0b000011010100, 12],
	[37, 0b000011010101, 12],
	[38, 0b000011010110, 12],
	[39, 0b000011010111, 12],
	[40, 0b000001101100, 12],
	[41, 0b000001101101, 12],
	[42, 0b000011011010, 12],
	[43, 0b000011011011, 12],
	[44, 0b000001010100, 12],
	[45, 0b000001010101, 12],
	[46, 0b000001010110, 12],
	[47, 0b000001010111, 12],
	[48, 0b000001100100, 12],
	[49, 0b000001100101, 12],
	[50, 0b000001010010, 12],
	[51, 0b000001010011, 12],
	[52, 0b000000100100, 12],
	[53, 0b000000110111, 12],
	[54, 0b000000111000, 12],
	[55, 0b000000100111, 12],
	[56, 0b000000101000, 12],
	[57, 0b000001011000, 12],
	[58, 0b000001011001, 12],
	[59, 0b000000101011, 12],
	[60, 0b000000101100, 12],
	[61, 0b000001011010, 12],
	[62, 0b000001100110, 12],
	[63, 0b000001100111, 12],
	[64, 0b0000001111, 10],
	[128, 0b000011001000, 12],
	[192, 0b000011001001, 12],
	[256, 0b000001011011, 12],
	[320, 0b000000110011, 12],
	[384, 0b000000110100, 12],
	[448, 0b000000110101, 12],
	[512, 0b0000001101100, 13],
	[576, 0b0000001101101, 13],
	[640, 0b0000001001010, 13],
	[704, 0b0000001001011, 13],
	[768, 0b0000001001100, 13],
	[832, 0b0000001001101, 13],
	[896, 0b0000001110010, 13],
	[960, 0b0000001110011, 13],
	[1024, 0b0000001110100, 13],
	[1088, 0b0000001110101, 13],
	[1152, 0b0000001110110, 13],
	[1216, 0b0000001110111, 13],
	[1280, 0b0000001010010, 13],
	[1344, 0b0000001010011, 13],
	[1408, 0b0000001010100, 13],
	[1472, 0b0000001010101, 13],
	[1536, 0b0000001011010, 13],
	[1600, 0b0000001011011, 13],
	[1664, 0b0000001100100, 13],
	[1728, 0b0000001100101, 13],
];

/** The counts of the head of the format of the fax of the counts of the places of the file of the colour of the
 * two of them, which stand for the counts of five hundred places of the file and over. */
const LONG_RUNS: readonly RunCode[] = [
	[1792, 0b00000001000, 11],
	[1856, 0b00000001100, 11],
	[1920, 0b00000001101, 11],
	[1984, 0b000000010010, 12],
	[2048, 0b000000010011, 12],
	[2112, 0b000000010100, 12],
	[2176, 0b000000010101, 12],
	[2240, 0b000000010110, 12],
	[2304, 0b000000010111, 12],
	[2368, 0b000000011100, 12],
	[2432, 0b000000011101, 12],
	[2496, 0b000000011110, 12],
	[2560, 0b000000011111, 12],
];

/** The counts of the head of the fax that stand for a count of the places of the file alone. */
const PASS = -100;

/** The counts of the head of the fax that stand for two counts of the places of the file. */
const HORIZONTAL = -101;

/** The counts of the head of the format of the fax of the two places of the file: the kind of the count of the
 * head, of the count of the places of the file it stands for and of the count of the places of the file of the
 * count of the head. */
const TWO_PLACE_CODES: readonly RunCode[] = [
	[PASS, 0b0001, 4],
	[0, 0b1, 1],
	[1, 0b011, 3],
	[2, 0b000011, 6],
	[3, 0b0000011, 7],
	[-1, 0b010, 3],
	[-2, 0b000010, 6],
	[-3, 0b0000010, 7],
	[HORIZONTAL, 0b001, 3],
];

/** The counts of the head of the format of the fax of the places of the file of a colour, of the count of the
 * places of the file of a count of the head behind them. */
function buildIndex(
	entries: readonly RunCode[],
): (Map<number, number> | undefined)[] {
	const index: (Map<number, number> | undefined)[] = [];
	for (const [run, code, length] of entries) {
		let map = index[length];
		if (!map) {
			map = new Map<number, number>();
			index[length] = map;
		}
		map.set(code, run);
	}
	return index;
}

const MODE_INDEX = buildIndex(TWO_PLACE_CODES);
const WHITE_INDEX = buildIndex([...WHITE_RUNS, ...LONG_RUNS]);
const BLACK_INDEX = buildIndex([...BLACK_RUNS, ...LONG_RUNS]);

/** The count of the places of the file of the counts of the head of the format of the fax of the two places of the
 * file the walk of this project reads. */
const LONGEST_CODE = 13;

/** A walk of the places of the file of a strip, of the count of the places of the file of the count of the head of
 * the format of the fax of the picture. */
class BitWalker {
	private place = 0;

	constructor(private readonly data: Buffer) {}

	/** The count of the head of the format of the fax of the two places of the file of a place of the file, of the
	 * value of the count of the head or of the count of the places of the file that stands for the end of them. */
	readCode(index: (Map<number, number> | undefined)[]): number {
		let code = 0;
		for (let length = 1; length <= LONGEST_CODE; length += 1) {
			const bit = this.readBit();
			if (bit < 0) return Number.NaN;
			code = (code << 1) | bit;
			const run = index[length]?.get(code);
			if (undefined !== run) return run;
		}
		return Number.NaN;
	}

	readBit(): number {
		if (this.place >= this.data.length * 8) return -1;
		const at = this.place >> 3;
		const bit = ((this.data[at] ?? 0) >> (7 - (this.place & 7))) & 1;
		this.place += 1;
		return bit;
	}

	/** Whether the places of the file of the strip stand behind the walk of the picture. */
	get done(): boolean {
		return this.place >= this.data.length * 8;
	}
}

/** A walk of the counts of the fax of a picture, of the counts of the head of the format of the fax of the colour of
 * the picture. The counts of the head of the format of the fax of the two places of the file stand of the counts of
 * the head of the format of the fax as the library of the counts of the head of the format of the fax of the picture
 * of this machine reads them (the walk of the counts of the head of the format of the fax of the count of the head of
 * the picture of the format, of the count of the head of the picture of the counts of the head of the format of the
 * fax. LICENSE of libtiff). */
export class FaxDecoder {
	private readonly rowBytes: number;

	/** The counts of the places of the file of the row of the picture in front of the row of the picture: one count of
	 * the places of the file of the colour of the picture and one count of the places of the file of the colour of the
	 * other stand behind the other, the count of the places of the file of the colour of the picture in front. */
	private runs: number[];

	constructor(
		private readonly width: number,
		private readonly kind: number,
		private readonly twoDimensional: boolean,
	) {
		this.rowBytes = (this.width + 7) >> 3;
		this.runs = [this.width, 0];
	}

	/** The places of the rows of a strip, of the count of the places of the file of every row of the picture, one
	 * place of the file a place of the picture. The count of one place of the file stands for the place of the colour
	 * of the picture of the head of the format of the fax (the count the library of this machine writes), which the
	 * walk of the picture of the file reads of the counts of the head of the picture. */
	read(strip: Buffer, count: number): Buffer[] {
		const walker = new BitWalker(strip);
		const rows: Buffer[] = [];
		for (;;) {
			if (rows.length >= count || walker.done) return rows;
			if (4 === this.kind) {
				rows.push(this.pack(this.readTwoPlaceRow(walker)));
				continue;
			}
			// Group 3 of the format: every row stands behind the count of the places of the file of the head of the
			// row of the picture, and the count of the head of the format of the fax of the two places of the file
			// stands behind a count of the head of the format of the fax of one place of the file that names the
			// walk of the row of the picture itself.
			const zeros = this.countZeros(walker);
			if (zeros < 0) return rows;
			if (zeros < 11)
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"A row of the picture of the fax stands of no count of the head of the head of the row of the picture",
				);
			if (this.twoDimensional) {
				const tag = walker.readBit();
				if (tag < 0) return rows;
				if (0 === tag) {
					rows.push(this.pack(this.readTwoPlaceRow(walker)));
					continue;
				}
			}
			rows.push(this.pack(this.readOnePlaceRow(walker)));
		}
	}

	/** The counts of the head of the format of the fax of the picture of the count of the places of the file of the
	 * head of the row of the picture of the colour of the picture. */
	private countZeros(walker: BitWalker): number {
		let zeros = 0;
		for (;;) {
			const bit = walker.readBit();
			if (bit < 0) return -1;
			if (0 === bit) {
				zeros += 1;
				continue;
			}
			return zeros;
		}
	}

	/** The counts of the places of the file of the row of the picture of the walk of the places of one place of the
	 * file (group 3 of the format, of the counts of the head of the format of the fax of one place of the file). */
	private readOnePlaceRow(walker: BitWalker): number[] {
		const runs: number[] = [];
		let at = 0;
		let colour = 0;
		for (let guard = 0; guard < 2 * this.width + 64; guard += 1) {
			if (at >= this.width) break;
			const run = this.readRun(walker, colour);
			runs.push(Math.min(run, this.width - at));
			at += run;
			colour ^= 1;
		}
		if (at < this.width) {
			if (1 === runs.length % 2) runs.push(0);
			runs.push(this.width - at);
		}
		this.runs = runs;
		return runs;
	}

	/** The counts of the places of the file of the row of the picture of the walk of the places of the two places of
	 * the file (group 4 of the format, of the counts of the head of the format of the fax of the two places of the
	 * file), of the counts of the places of the file of the row of the picture in front of it. The counts of the
	 * places of the file of the colour of the picture and the counts of the places of the file of the colour of the
	 * other of the row of the picture in front of the row of the picture stand of the counts of the head of the
	 * format of the fax of the two places of the file: the count of the places of the file of the colour of the
	 * picture of the count of the head of the format of the fax of the two places of the file stands for the count of
	 * the places of the file of the colour of the picture in front of it, and the count of the places of the file of
	 * the colour of the other of it stands behind it, which the walk of the counts of the head of the format of the
	 * fax of the file reads of the counts of the head of the format of the fax of the count of the head of the
	 * picture. */
	private readTwoPlaceRow(walker: BitWalker): number[] {
		const reference = this.runs;
		const runs: number[] = [];
		let at = 0;
		let run = 0;
		let first = reference[0] ?? this.width;
		let index = 1;
		const check = (): void => {
			// The counts of the head of the format of the fax of the two places of the file of the head of the row of
			// the picture stand of the count of the places of the file of the colour of the picture in front of the
			// row of the picture itself where the row of the picture stands of no count of the places of the file of
			// the colour of the picture of its own yet: the count of the places of the file of the colour of the
			// picture of the row of the picture in front of the row of the picture of no places of the file stands of
			// a count of the places of the file to the right of the head of the row of the picture as well.
			if (0 === runs.length) return;
			while (first <= at && first < this.width) {
				first += (reference[index] ?? 0) + (reference[index + 1] ?? 0);
				index += 2;
			}
		};
		const set = (extra: number): void => {
			const held = run + extra;
			if (held < 0)
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"A row of the picture of the fax stands of a count of the places of the file in front of the head of the row of the picture",
				);
			if (at + extra > this.width) {
				runs.push(this.width - at);
				run = 0;
				at = this.width;
				return;
			}
			runs.push(held);
			at += extra;
			run = 0;
		};
		const advance = (): void => {
			first += reference[index] ?? 0;
			index += 1;
		};
		for (let guard = 0; guard < 2 * this.width + 64; guard += 1) {
			if (at >= this.width) break;
			const mode = walker.readCode(MODE_INDEX);
			if (Number.isNaN(mode))
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"A row of the picture of the fax stands of a count of the head of the format of the fax of the two places of the file this walk does not read",
				);
			if (PASS === mode) {
				check();
				run += first - at;
				at = first;
				advance();
				continue;
			}
			if (HORIZONTAL === mode) {
				if (1 === runs.length % 2) {
					const black = this.readRun(walker, 1);
					const white = this.readRun(walker, 0);
					set(black);
					set(white);
				} else {
					const white = this.readRun(walker, 0);
					const black = this.readRun(walker, 1);
					set(white);
					set(black);
				}
				check();
				continue;
			}
			check();
			set(first - at + mode);
			advance();
		}
		if (at < this.width) {
			if (1 === runs.length % 2) runs.push(0);
			runs.push(this.width - at);
		}
		runs.push(run);
		this.runs = runs;
		return runs;
	}

	/** The count of the places of the file of a count of the head of the format of the fax of a colour of the
	 * picture, of the counts of the head of the format of the fax of the colour of the picture that stand for the
	 * counts of the head of the format of the fax of the counts of many places of the file. */
	private readRun(walker: BitWalker, colour: number): number {
		let total = 0;
		for (let guard = 0; guard < 64; guard += 1) {
			const run = walker.readCode(0 === colour ? WHITE_INDEX : BLACK_INDEX);
			if (Number.isNaN(run))
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"A count of the places of the file of the colour of the picture of the fax stands of no count of the head of the format of the fax this walk reads",
				);
			total += run;
			if (run < 64) return total;
		}
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"A count of the places of the file of the colour of the picture of the fax stands of counts of the head of the format of the fax of its own",
		);
	}

	/** The places of the file of the row of the picture, of one count of the places of the file a place of the
	 * picture, of the counts of the places of the file of the colour of the picture (nothing) and of the counts of the
	 * places of the file of the colour of the other (one) the walk of the counts of the head of the format of the fax
	 * of this machine stands. */
	private pack(runs: number[]): Buffer {
		const row: Buffer = Buffer.alloc(this.rowBytes, 0x00);
		let at = 0;
		for (let index = 0; index < runs.length; index += 1) {
			const run = runs[index] ?? 0;
			if (0 === index % 2) {
				at += run;
				continue;
			}
			for (let place = 0; place < run; place += 1) this.setBit(row, at + place);
			at += run;
		}
		return row;
	}

	/** The count of one place of the file of the row of the picture of the colour of the other. */
	private setBit(row: Buffer, place: number): void {
		if (place < 0 || place >= this.width) return;
		const at = place >> 3;
		row[at] = ((row[at] ?? 0) | (1 << (7 - (place & 7)))) & 0xff;
	}
}

/** The count of the places of the file of the rows of the picture of the walk of the counts of the fax, of the
 * counts of the head of the format of the fax of the colour of the picture of the count of the places of the file
 * of the picture itself. */
export function faxCompression(kind: number): boolean {
	return 3 === kind || 4 === kind;
}
