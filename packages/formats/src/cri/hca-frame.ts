// The walks of the counts of a frame of a sound of the Cri engine (`HCA`), of the reference
// `ArcFormats/Cri/AudioHCA.cs`: the counts of the places of a block of the walk of the engine (`CheckSum`),
// the counts of the places of the sound of the engine (`HsaBitStream`), the counts of the places of a picture
// of the engine of a sound of the engine (`Channel.Decode1`), the counts of the places of a picture of it
// (`Channel.Decode2` and `Channel.Decode3`) and the counts of the places of a picture of the engine of a count
// of the places of the picture that stands behind it (`Channel.Decode4`). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// Every count of the places of a picture of the engine of a sound of the engine stands of a frame of `0x400`
// places of a colour for every count of the places of the sound. The walk of the counts of a picture of the
// engine itself (`Channel.Decode5`, the counts of the places of the picture of the engine and the counts of
// the places of the sound) stands unported here.

import { GarbroError } from "@garbro-mcp/core";

/** The counts of the places of a block of the walk of the engine (`CheckSumTable`). */
const CHECKSUM_TABLE = new Uint16Array([
	0x0000, 0x8005, 0x800f, 0x000a, 0x801b, 0x001e, 0x0014, 0x8011, 0x8033,
	0x0036, 0x003c, 0x8039, 0x0028, 0x802d, 0x8027, 0x0022, 0x8063, 0x0066,
	0x006c, 0x8069, 0x0078, 0x807d, 0x8077, 0x0072, 0x0050, 0x8055, 0x805f,
	0x005a, 0x804b, 0x004e, 0x0044, 0x8041, 0x80c3, 0x00c6, 0x00cc, 0x80c9,
	0x00d8, 0x80dd, 0x80d7, 0x00d2, 0x00f0, 0x80f5, 0x80ff, 0x00fa, 0x80eb,
	0x00ee, 0x00e4, 0x80e1, 0x00a0, 0x80a5, 0x80af, 0x00aa, 0x80bb, 0x00be,
	0x00b4, 0x80b1, 0x8093, 0x0096, 0x009c, 0x8099, 0x0088, 0x808d, 0x8087,
	0x0082, 0x8183, 0x0186, 0x018c, 0x8189, 0x0198, 0x819d, 0x8197, 0x0192,
	0x01b0, 0x81b5, 0x81bf, 0x01ba, 0x81ab, 0x01ae, 0x01a4, 0x81a1, 0x01e0,
	0x81e5, 0x81ef, 0x01ea, 0x81fb, 0x01fe, 0x01f4, 0x81f1, 0x81d3, 0x01d6,
	0x01dc, 0x81d9, 0x01c8, 0x81cd, 0x81c7, 0x01c2, 0x0140, 0x8145, 0x814f,
	0x014a, 0x815b, 0x015e, 0x0154, 0x8151, 0x8173, 0x0176, 0x017c, 0x8179,
	0x0168, 0x816d, 0x8167, 0x0162, 0x8123, 0x0126, 0x012c, 0x8129, 0x0138,
	0x813d, 0x8137, 0x0132, 0x0110, 0x8115, 0x811f, 0x011a, 0x810b, 0x010e,
	0x0104, 0x8101, 0x8303, 0x0306, 0x030c, 0x8309, 0x0318, 0x831d, 0x8317,
	0x0312, 0x0330, 0x8335, 0x833f, 0x033a, 0x832b, 0x032e, 0x0324, 0x8321,
	0x0360, 0x8365, 0x836f, 0x036a, 0x837b, 0x037e, 0x0374, 0x8371, 0x8353,
	0x0356, 0x035c, 0x8359, 0x0348, 0x834d, 0x8347, 0x0342, 0x03c0, 0x83c5,
	0x83cf, 0x03ca, 0x83db, 0x03de, 0x03d4, 0x83d1, 0x83f3, 0x03f6, 0x03fc,
	0x83f9, 0x03e8, 0x83ed, 0x83e7, 0x03e2, 0x83a3, 0x03a6, 0x03ac, 0x83a9,
	0x03b8, 0x83bd, 0x83b7, 0x03b2, 0x0390, 0x8395, 0x839f, 0x039a, 0x838b,
	0x038e, 0x0384, 0x8381, 0x0280, 0x8285, 0x828f, 0x028a, 0x829b, 0x029e,
	0x0294, 0x8291, 0x82b3, 0x02b6, 0x02bc, 0x82b9, 0x02a8, 0x82ad, 0x82a7,
	0x02a2, 0x82e3, 0x02e6, 0x02ec, 0x82e9, 0x02f8, 0x82fd, 0x82f7, 0x02f2,
	0x02d0, 0x82d5, 0x82df, 0x02da, 0x82cb, 0x02ce, 0x02c4, 0x82c1, 0x8243,
	0x0246, 0x024c, 0x8249, 0x0258, 0x825d, 0x8257, 0x0252, 0x0270, 0x8275,
	0x827f, 0x027a, 0x826b, 0x026e, 0x0264, 0x8261, 0x0220, 0x8225, 0x822f,
	0x022a, 0x823b, 0x023e, 0x0234, 0x8231, 0x8213, 0x0216, 0x021c, 0x8219,
	0x0208, 0x820d, 0x8207, 0x0202,
]);

/**
 * The counts of the places of a block of a sound of the engine (`CheckSum`): a walk of the counts of the
 * places of the sound of the engine, of the count of the places of the counts of the walk of the engine itself.
 * A block of a sound of the engine of no counts of the walk of the engine at all stands of the last two counts
 * of the block, which stand of the counts of the walk of the engine of the places of the block itself.
 */
export function checkHcaBlock(data: Uint8Array, sum = 0): number {
	let value = sum & 0xffff;
	for (let at = 0; at < data.length; at += 1) {
		value =
			((value << 8) ^
				(CHECKSUM_TABLE[((value >> 8) ^ (data[at] ?? 0)) & 0xff] ?? 0)) &
			0xffff;
	}
	return value;
}

/**
 * The counts of the places of a sound of the engine (`HsaBitStream`): the counts of the walk of the engine
 * stand of the places of the sound of the engine, of the counts of the places of the picture of the engine of
 * the places of the count of the walk of the engine that stand in front of them. A walk of the engine behind
 * the end of the sound of the engine stands of no count of the places at all, and the walk of the engine of
 * the counts of the places of the picture of the engine (`seek`) stands of no count of the places behind the
 * places of the sound of the engine that stand in front of it (`Math.max (position, 0)`).
 */
export class HcaBitStream {
	readonly #data: Uint8Array;
	#at = 0;
	#bits = 0;
	#cached = 0;

	constructor(data: Uint8Array) {
		this.#data = data;
	}

	/** The counts of the places of the picture of the engine, of no walk of the engine behind them. */
	peek(count: number): number {
		while (this.#cached < count) {
			if (this.#at >= this.#data.length) return -1;
			this.#bits = (this.#bits << 8) | (this.#data[this.#at] ?? 0);
			this.#cached += 8;
			this.#at += 1;
		}
		return (this.#bits >> (this.#cached - count)) & ((1 << count) - 1);
	}

	getBits(count: number): number {
		const value = this.peek(count);
		this.#cached -= count;
		return value;
	}

	/** The walk of the engine of the counts of the places of the picture of the engine. */
	seek(offset: number): void {
		if (offset > 0 && offset <= this.#cached) {
			this.#cached -= offset;
			return;
		}
		const position = Math.max(this.#at * 8 - this.#cached + offset, 0);
		this.#cached = 0;
		this.#at = Math.trunc(position / 8);
		const bitPosition = position & 7;
		if (0 !== bitPosition) this.getBits(bitPosition);
	}
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The counts of the places of the picture of the engine of a count of the places of the walk of it. */
const SCALE_TABLE = [
	0x0e, 0x0e, 0x0e, 0x0e, 0x0e, 0x0e, 0x0d, 0x0d, 0x0d, 0x0d, 0x0d, 0x0d, 0x0c,
	0x0c, 0x0c, 0x0c, 0x0c, 0x0c, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0a, 0x0a,
	0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x09, 0x09, 0x09, 0x09, 0x09, 0x09, 0x08, 0x08,
	0x08, 0x08, 0x08, 0x08, 0x07, 0x06, 0x06, 0x05, 0x04, 0x04, 0x04, 0x03, 0x03,
	0x03, 0x02, 0x02, 0x02, 0x02, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x0e,
	0x0e, 0x0e, 0x0e, 0x0e, 0x0e, 0x0d, 0x0d, 0x0d, 0x0d, 0x0d, 0x0d, 0x0c, 0x0c,
	0x0c, 0x0c, 0x0c, 0x0c, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0a, 0x0a, 0x0a,
	0x0a, 0x0a, 0x0a, 0x0a, 0x09, 0x09, 0x09, 0x09, 0x09, 0x09, 0x08, 0x08, 0x08,
	0x08, 0x08, 0x08, 0x07, 0x06, 0x06, 0x05, 0x04, 0x04, 0x04, 0x03, 0x03, 0x03,
	0x02, 0x02, 0x02, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
];

/** The counts of the places of the picture of the engine (`Decode1Value`). */
const DECODE1_VALUE = [
	Math.fround(1.588383e-7),
	Math.fround(2.116414e-7),
	Math.fround(2.819978e-7),
	Math.fround(3.757431e-7),
	Math.fround(5.006523e-7),
	Math.fround(6.670855e-7),
	Math.fround(8.888464e-7),
	Math.fround(1.184328e-6),
	Math.fround(1.578037e-6),
	Math.fround(2.102628e-6),
	Math.fround(2.80161e-6),
	Math.fround(3.732956e-6),
	Math.fround(4.973912e-6),
	Math.fround(6.627403e-6),
	Math.fround(8.830567e-6),
	Math.fround(1.176613e-5),
	Math.fround(1.567758e-5),
	Math.fround(2.088932e-5),
	Math.fround(2.783361e-5),
	Math.fround(3.708641e-5),
	Math.fround(4.941514e-5),
	Math.fround(6.584233e-5),
	Math.fround(8.773047e-5),
	Math.fround(0.0001168949),
	Math.fround(0.0001557546),
	Math.fround(0.0002075325),
	Math.fround(0.0002765231),
	Math.fround(0.0003684484),
	Math.fround(0.0004909326),
	Math.fround(0.0006541346),
	Math.fround(0.0008715902),
	Math.fround(0.001161335),
	Math.fround(0.001547401),
	Math.fround(0.002061807),
	Math.fround(0.002747219),
	Math.fround(0.003660484),
	Math.fround(0.004877347),
	Math.fround(0.006498737),
	Math.fround(0.008659128),
	Math.fround(0.0115377),
	Math.fround(0.01537321),
	Math.fround(0.02048377),
	Math.fround(0.02729324),
	Math.fround(0.0363664),
	Math.fround(0.04845578),
	Math.fround(0.06456406),
	Math.fround(0.08602725),
	Math.fround(0.1146255),
	Math.fround(0.1527307),
	Math.fround(0.2035034),
	Math.fround(0.2711546),
	Math.fround(0.3612952),
	Math.fround(0.4814015),
	Math.fround(0.641435),
	Math.fround(0.8546689),
	Math.fround(1.138789),
	Math.fround(1.517359),
	Math.fround(2.021779),
	Math.fround(2.693884),
	Math.fround(3.589418),
	Math.fround(4.782658),
	Math.fround(6.372569),
	Math.fround(8.491017),
	Math.fround(11.31371),
];

/** The counts of the places of the picture of the engine (`Decode1Scale`). */
const DECODE1_SCALE = [
	Math.fround(0),
	Math.fround(2.0 / 3),
	Math.fround(2.0 / 5),
	Math.fround(2.0 / 7),
	Math.fround(2.0 / 9),
	Math.fround(2.0 / 11),
	Math.fround(2.0 / 13),
	Math.fround(2.0 / 15),
	Math.fround(2.0 / 31),
	Math.fround(2.0 / 63),
	Math.fround(2.0 / 127),
	Math.fround(2.0 / 255),
	Math.fround(2.0 / 511),
	Math.fround(2.0 / 1023),
	Math.fround(2.0 / 2047),
	Math.fround(2.0 / 4095),
];

/** The counts of the places of a picture of the engine (`Decode2Table1`). */
const DECODE2_TABLE1 = [
	0x00, 0x02, 0x03, 0x03, 0x04, 0x04, 0x04, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
	0x0a, 0x0b, 0x0c,
];

/** The counts of the places of a picture of the engine (`Decode2Table2`). */
const DECODE2_TABLE2 = [
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x01, 0x01, 0x02, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x03,
	0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x02, 0x03, 0x03,
	0x03, 0x03, 0x03, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03,
	0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03,
	0x04, 0x04, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x04,
	0x04, 0x04, 0x04, 0x04, 0x04, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x04, 0x04,
	0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x03, 0x03, 0x04, 0x04, 0x04,
	0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04,
];

/** The counts of the places of a picture of the engine (`Decode2Table3`). */
const DECODE2_TABLE3 = [
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(1),
	Math.fround(-1),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(1),
	Math.fround(1),
	Math.fround(-1),
	Math.fround(-1),
	Math.fround(2),
	Math.fround(-2),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(1),
	Math.fround(-1),
	Math.fround(2),
	Math.fround(-2),
	Math.fround(3),
	Math.fround(-3),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(1),
	Math.fround(1),
	Math.fround(-1),
	Math.fround(-1),
	Math.fround(2),
	Math.fround(2),
	Math.fround(-2),
	Math.fround(-2),
	Math.fround(3),
	Math.fround(3),
	Math.fround(-3),
	Math.fround(-3),
	Math.fround(4),
	Math.fround(-4),
	Math.fround(0),
	Math.fround(0),
	Math.fround(1),
	Math.fround(1),
	Math.fround(-1),
	Math.fround(-1),
	Math.fround(2),
	Math.fround(2),
	Math.fround(-2),
	Math.fround(-2),
	Math.fround(3),
	Math.fround(-3),
	Math.fround(4),
	Math.fround(-4),
	Math.fround(5),
	Math.fround(-5),
	Math.fround(0),
	Math.fround(0),
	Math.fround(1),
	Math.fround(1),
	Math.fround(-1),
	Math.fround(-1),
	Math.fround(2),
	Math.fround(-2),
	Math.fround(3),
	Math.fround(-3),
	Math.fround(4),
	Math.fround(-4),
	Math.fround(5),
	Math.fround(-5),
	Math.fround(6),
	Math.fround(-6),
	Math.fround(0),
	Math.fround(0),
	Math.fround(1),
	Math.fround(-1),
	Math.fround(2),
	Math.fround(-2),
	Math.fround(3),
	Math.fround(-3),
	Math.fround(4),
	Math.fround(-4),
	Math.fround(5),
	Math.fround(-5),
	Math.fround(6),
	Math.fround(-6),
	Math.fround(7),
	Math.fround(-7),
];

/** The counts of the places of a picture of the engine (`Decode3Table`). */
const DECODE3_TABLE = [
	Math.fround(1),
	Math.fround(1.332433),
	Math.fround(1.775376),
	Math.fround(2.365569),
	Math.fround(3.151962),
	Math.fround(4.199776),
	Math.fround(5.595919),
	Math.fround(7.456184),
	Math.fround(9.934862),
	Math.fround(13.23753),
	Math.fround(17.63812),
	Math.fround(23.50161),
	Math.fround(31.31431),
	Math.fround(41.7242),
	Math.fround(55.59468),
	Math.fround(74.07616),
	Math.fround(98.70149),
	Math.fround(131.5131),
	Math.fround(175.2323),
	Math.fround(233.4852),
	Math.fround(311.1033),
	Math.fround(414.5242),
	Math.fround(552.3255),
	Math.fround(735.9365),
	Math.fround(980.5858),
	Math.fround(1306.564),
	Math.fround(1740.909),
	Math.fround(2319.644),
	Math.fround(3090.769),
	Math.fround(4118.241),
	Math.fround(5487.278),
	Math.fround(7311.428),
	Math.fround(9741.984),
	Math.fround(12980.54),
	Math.fround(17295.69),
	Math.fround(23045.34),
	Math.fround(30706.36),
	Math.fround(40914.16),
	Math.fround(54515.36),
	Math.fround(72638.03),
	Math.fround(96785.28),
	Math.fround(128959.9),
	Math.fround(171830.3),
	Math.fround(228952.3),
	Math.fround(305063.5),
	Math.fround(406476.5),
	Math.fround(541602.6),
	Math.fround(721648.9),
	Math.fround(961548.4),
	Math.fround(1281198),
	Math.fround(1707111),
	Math.fround(2274610),
	Math.fround(3030764),
	Math.fround(4038288),
	Math.fround(5380747),
	Math.fround(7169482),
	Math.fround(9552851),
	Math.fround(1.272853e7),
	Math.fround(1.695991e7),
	Math.fround(2.259793e7),
	Math.fround(3.011022e7),
	Math.fround(4.011984e7),
	Math.fround(5.345698e7),
	Math.fround(0),
];

/** The counts of the places of a picture of the engine (`Decode4Table`). */
const DECODE4_TABLE = [
	Math.fround(2.0),
	Math.fround(1.857143),
	Math.fround(1.714286),
	Math.fround(1.571429),
	Math.fround(1.428571),
	Math.fround(1.285714),
	Math.fround(1.142857),
	Math.fround(1),
	Math.fround(0.8571429),
	Math.fround(0.7142857),
	Math.fround(0.5714286),
	Math.fround(0.4285714),
	Math.fround(0.2857143),
	Math.fround(0.1428571),
	Math.fround(0),
	Math.fround(0),
	Math.fround(0),
	Math.fround(1.870663e-8),
	Math.fround(2.492532e-8),
	Math.fround(3.321131e-8),
	Math.fround(4.425183e-8),
	Math.fround(5.896258e-8),
	Math.fround(7.856367e-8),
	Math.fround(1.046808e-7),
	Math.fround(1.394801e-7),
	Math.fround(1.858478e-7),
	Math.fround(2.476297e-7),
	Math.fround(3.299498e-7),
	Math.fround(4.396359e-7),
	Math.fround(5.857852e-7),
	Math.fround(7.805192e-7),
	Math.fround(1.039989e-6),
	Math.fround(1.385715e-6),
	Math.fround(1.846372e-6),
	Math.fround(2.460167e-6),
	Math.fround(3.278006e-6),
	Math.fround(4.367722e-6),
	Math.fround(5.819695e-6),
	Math.fround(7.754351e-6),
	Math.fround(1.033215e-5),
	Math.fround(1.376689e-5),
	Math.fround(1.834346e-5),
	Math.fround(2.444142e-5),
	Math.fround(3.256654e-5),
	Math.fround(4.339272e-5),
	Math.fround(5.781787e-5),
	Math.fround(7.703841e-5),
	Math.fround(0.0001026485),
	Math.fround(0.0001367722),
	Math.fround(0.0001822397),
	Math.fround(0.0002428221),
	Math.fround(0.0003235441),
	Math.fround(0.0004311007),
	Math.fround(0.0005744126),
	Math.fround(0.000765366),
	Math.fround(0.001019799),
	Math.fround(0.001358813),
	Math.fround(0.001810526),
	Math.fround(0.002412404),
	Math.fround(0.003214366),
	Math.fround(0.004282926),
	Math.fround(0.00570671),
	Math.fround(0.007603806),
	Math.fround(0.01013156),
	Math.fround(0.01349962),
	Math.fround(0.01798733),
	Math.fround(0.02396691),
	Math.fround(0.03193429),
	Math.fround(0.04255028),
	Math.fround(0.05669538),
	Math.fround(0.07554277),
	Math.fround(0.1006556),
	Math.fround(0.1341169),
	Math.fround(0.1787017),
	Math.fround(0.2381079),
	Math.fround(0.3172627),
	Math.fround(0.4227312),
	Math.fround(0.5632608),
	Math.fround(0.7505071),
	Math.fround(0),
];

/** The count of the places of a picture of the engine of a count of the places of a sound of the engine. */
export const HCA_BLOCK_PLACES = 0x80;
const VALUE_LIMIT = 0x80;
const SCALE_LIMIT = 0x39;
/**
 * The places of the counts of the walk of the engine of the counts of the places of the picture of the
 * engine: the reference stands of the counts of the places of the picture of the engine of the *second*
 * counts of the walk of the engine of the counts of them (`ScaleVersion` of the walk of the engine of a count
 * of the places of the picture of the engine stands of the count of one place of the counts of the walk of
 * the engine itself).
 */
const SCALE_ROW = 0x40;

/** The counts of the places of a picture of the engine of a count of the places of the walk of the sound. */
export class HcaChannel {
	readonly type: number;
	readonly valuePtr: number;
	readonly count: number;
	readonly value = new Int8Array(VALUE_LIMIT);
	readonly scale = new Int8Array(VALUE_LIMIT);
	readonly value2 = new Int8Array(8);
	readonly base = new Float32Array(VALUE_LIMIT);
	readonly block = new Float32Array(VALUE_LIMIT);

	constructor(type: number, r06: number, r07: number) {
		this.type = type;
		this.valuePtr = r06 + r07;
		this.count = 2 === type ? r06 : r06 + r07;
	}

	/**
	 * The counts of the places of the picture of the engine of a sound of the engine (`Channel.Decode1`):
	 * the counts of the walk of the engine from the counts of the places of the picture of the engine itself,
	 * of the counts of the places of the counts of the walk of the engine of the table of the places of the
	 * sound of the engine.
	 */
	decode1(bits: HcaBitStream, a: number, b: number, ath: Uint8Array): void {
		let v = bits.getBits(3);
		if (v >= 6) {
			for (let index = 0; index < this.count; index += 1)
				this.value[index] = bits.getBits(6);
		} else if (0 !== v) {
			let v1 = bits.getBits(6);
			const v2 = (1 << v) - 1;
			const v3 = v2 >> 1;
			this.value[0] = v1;
			for (let index = 1; index < this.count; index += 1) {
				const v4 = bits.getBits(v);
				if (v4 !== v2) v1 += v4 - v3;
				else v1 = bits.getBits(6);
				this.value[index] = v1;
			}
		} else {
			this.value.fill(0);
		}
		if (2 === this.type) {
			// The counts of the places of the picture of the engine of a count of the places of the walk of
			// the engine of the kind of the count of two places of the places of the picture stand of the
			// counts of the places of the picture of the engine itself, of the counts of the places of the
			// walk of the engine of the counts of four places of the counts of the walk of the engine.
			v = bits.peek(4);
			this.value2[0] = v;
			if (v < 15) {
				for (let index = 0; index < 8; index += 1)
					this.value2[index] = bits.getBits(4);
			}
		} else {
			for (let index = 0; index < a; index += 1)
				this.value[this.valuePtr + index] = bits.getBits(6);
		}
		for (let index = 0; index < this.count; index += 1) {
			let scale = this.value[index] ?? 0;
			if (0 !== scale) {
				// The counts of the places of the counts of the walk of the engine of the table of the places
				// of the sound of the engine stand of the counts of the places of the sound itself, of the
				// counts of the places of the walk of the engine of the counts of them and of the places of
				// the counts of the walk of the engine of the table of the counts of the places of it.
				scale = (ath[index] ?? 0) + ((b + index) >> 8) - ((scale * 5) >> 1) + 1;
				if (scale < 0) scale = 15;
				else if (scale >= SCALE_LIMIT) scale = 1;
				// The counts of the places of the picture of the engine of the counts of the walk of the
				// engine stand of the counts of the places of the picture of the engine of the second places
				// of the counts of the walk of the engine of the counts of them, which stand of the counts of
				// the places of the picture of the engine of every count of them.
				else scale = SCALE_TABLE[SCALE_ROW + scale] ?? 0;
			}
			this.scale[index] = scale;
		}
		for (let index = this.count; index < VALUE_LIMIT; index += 1)
			this.scale[index] = 0;
		for (let index = 0; index < this.count; index += 1)
			this.base[index] =
				(DECODE1_VALUE[this.value[index] ?? 0] ?? 0) *
				(DECODE1_SCALE[this.scale[index] ?? 0] ?? 0);
	}

	/** The counts of the places of a picture of the engine of a count of the walk of the engine. */
	decode2(bits: HcaBitStream): void {
		for (let index = 0; index < this.count; index += 1) {
			const scale = this.scale[index] ?? 0;
			const bitSize = DECODE2_TABLE1[scale] ?? 0;
			let v = bits.getBits(bitSize);
			let f: number;
			if (scale < 8) {
				// The counts of the places of the picture of the engine of the counts of the places of the
				// walk of the engine of the table of the counts of the places of it stand of the counts of
				// the places of the walk of the engine itself, of the count of the walk of the engine of the
				// counts of the places of the picture of the engine.
				v += scale << 4;
				bits.seek((DECODE2_TABLE2[v] ?? 0) - bitSize);
				f = DECODE2_TABLE3[v] ?? 0;
			} else {
				v = (1 - ((v & 1) << 1)) * (v >> 1);
				if (0 === v) bits.seek(-1);
				f = v;
			}
			this.block[index] = (this.base[index] ?? 0) * f;
		}
		for (let index = this.count; index < VALUE_LIMIT; index += 1)
			this.block[index] = 0;
	}

	/** The counts of the places of a picture of the engine of the counts of the places of it. */
	decode3(a: number, b: number, c: number, d: number): void {
		if (2 !== this.type && 0 !== b) {
			for (let index = 0, k = c, l = c - 1; index < a; index += 1) {
				for (let j = 0; j < b && k < d; j += 1, l += 1) {
					const place =
						(this.value[(this.valuePtr + index) | 0] ?? 0) -
						(this.value[l] ?? 0);
					// The reference stands of the counts of the places of the picture of the engine of the
					// counts of the places of the walk of the engine of the counts of them: this port refuses
					// a count of the places of the picture of the engine that stands behind the counts of the
					// walk of the engine.
					if (place < 0 || place >= DECODE3_TABLE.length)
						throw invalidSound("Invalid HCA block value");
					this.block[k] = (DECODE3_TABLE[place] ?? 0) * (this.block[l] ?? 0);
					k += 1;
				}
			}
			this.block[0x7f] = 0;
		}
	}

	/** The counts of the places of a picture of the engine of a count of the walk of the engine behind it. */
	decode4(
		index: number,
		a: number,
		b: number,
		c: number,
		next: HcaChannel,
	): void {
		if (1 === this.type && 0 !== c) {
			const f1 = DECODE4_TABLE[next.value2[index] ?? 0] ?? 0;
			const f2 = f1 - 2.0;
			for (let at = 0; at < a; at += 1) {
				next.block[b] = (this.block[b] ?? 0) * f2;
				this.block[b] = (this.block[b] ?? 0) * f1;
				b += 1;
			}
		}
	}
}
