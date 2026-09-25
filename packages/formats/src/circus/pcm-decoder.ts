// Format reference: GARbro "ArcFormats/Circus/AudioPCM.cs", classes `PcmDecoder` and `XpcmCompression`,
// whose walk the reference wrote out of a disassembly (`sub_412070`, `sub_4121C0`, `sub_411AB0`,
// `sub_4122B0`). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The walk of this port was checked against an independent implementation of the same codec: the test tool
// of the vgmstream project (`xpcm.c` by bnnm,
// <https://gist.github.com/bnnm/ce4ca7be8950614df96b4f4f8a91c766>), which was read out of the games' own
// executables as well. Its `interleave`, `scale`, `transform` and `convert` agree with the reference step
// for step, including the frame overlap that mixes the last 32 samples of the frame before into the first
// 32 places of a frame, and the closing shift of the transform that turns its places into samples. The
// table of sines and cosines the reference carries (`dword_43A358`) is the closed form below, and the
// scales it carries (`unk_43A254`) are the rows of the independent reading's own table of scales.

/** One frame of the encoded stream walks 0x2000 places into 4064 samples and 32 places of overlap. */
const INPUT_HALF = 0x1000;
const INPUT_QUARTER = 0x800;
const CODE_COUNT = 4096;
const SAMPLE_COUNT = 4064;
const OVERLAP_COUNT = 32;
const FRAME_STEP = 8192;
const DECODED_STEP = 8128;
/** The window walk takes a scale every 0x1000 places, and the reference reaches eight of a block. */
const SCALE_STEP = 0x1000;
const SCALE_PLACES = 32768;
/** The transform: twelve steps, `bits - 2` levels of butterflies, and its closing blocks. */
const TRANSFORM_BITS = 12;
const TRANSFORM_LEVELS = TRANSFORM_BITS - 2;
const TRANSFORM_BLOCK = 4;
const TRANSFORM_PAIR = 2;
const TRANSFORM_WHOLE = 1;
const TWIDDLE_BASE = 2;
const SHIFT_TWIDDLE = 12;
const SHIFT_OUTPUT = 14;
const OUTPUT_SHIFT = 4;
const OUTPUT_MASK = 0x3fff;
const SIGN_SHIFT = 16;
const HIGH_MASK = 0x1f;
const INT32 = 4294967296;
const SAMPLE_MAX = 32767;
const SAMPLE_MIN = -32768;
/** `UnpackV1`: the controls of the container of the first packed mode. */
const LZSS_FLAG = 0x100;
const LZSS_FLAG_HIGH = 0xff00;
const LZSS_LONG = 0xc0;
const LZSS_SHORT = 0x80;
const LZSS_LONG_LENGTH = 0x7f;
const LZSS_SHORT_MASK = 0x1f;
const LZSS_SHORT_SHIFT = 5;
const LZSS_SHORT_COUNT = 3;
const LZSS_LONG_MASK = 3;
const LZSS_LONG_SHIFT = 2;
const LZSS_LONG_COUNT = 0xf;
const LZSS_COUNT_BASE = 4;
const LZSS_PAIR_BASE = 2;

/**
 * The scales of the four kinds of `extra` (`unk_43A254`). Every block of the reference holds sixteen
 * words, of which its own walk reaches the first eight; the eight words of a whole one behind them are
 * left out.
 */
const SCALES: readonly (readonly number[])[] = [
	[2048, 2048, 4096, 4096, 8192, 8192, 16384, 16384],
	[2048, 2048, 2048, 4096, 4096, 4096, 8192, 16384],
	[2048, 2048, 2048, 2048, 2048, 4096, 4096, 8192],
	[1024, 1024, 1024, 2048, 2048, 2048, 2048, 2048],
];

/** The cosine and the sine of every step of the transform: `dword_43A358` in closed form. */
const TWIDDLE: readonly number[] = (() => {
	const table: number[] = [];
	for (let step = 0; step < CODE_COUNT / TRANSFORM_BLOCK; step += 1) {
		const angle = (2 * Math.PI * step) / CODE_COUNT;
		table.push(
			Math.trunc(Math.cos(angle) * CODE_COUNT),
			Math.trunc(Math.sin(angle) * CODE_COUNT),
		);
	}
	return table;
})();

/**
 * `PcmDecoder.InitTable` (`word_6A56C8`): the lowest letter of a sixteen bit code is its own sign, so the
 * value of a code is `(code >> 1) + 1` for an odd one and `-(code >> 1)` for an even one. The table of the
 * engine holds sixteen bit words, so its last code turns to the lowest word.
 */
export function pcmCodedValue(code: number): number {
	const value = 0 !== (code & 1) ? (code >> 1) + 1 : -(code >> 1);
	return (value << SIGN_SHIFT) >> SIGN_SHIFT;
}

/** The `>> 12` of a sixty four bit product of the reference, kept as the low word of its own cast. */
function shiftTwiddle(value: number, coefficient: number): number {
	return Math.floor((value * coefficient) / (1 << SHIFT_TWIDDLE)) | 0;
}

/** `Binary.CopyOverlapped`: a run of the container, which may reach into the places just written. */
function copyOverlapped(
	output: Buffer,
	from: number,
	to: number,
	count: number,
): void {
	for (let i = 0; i < count; i += 1) {
		const source = from + i;
		if (source < 0 || to + i >= output.length) break;
		output[to + i] = output[source] ?? 0;
	}
}

/** `PcmDecoder.UnpackV1` (`sub_412070`): the container of the first packed mode. */
export function unpackPcmLzss(
	input: Buffer,
	packedSize: number,
	output: Buffer,
): void {
	let flag = 0;
	let destination = 0;
	let source = 0;
	while (source < packedSize) {
		flag >>= 1;
		if (0 === (flag & LZSS_FLAG)) {
			flag = (input[source++] ?? 0) | LZSS_FLAG_HIGH;
		}
		if (0 !== (flag & 1)) {
			if (destination < output.length) {
				output[destination] = input[source] ?? 0;
			}
			destination += 1;
			source += 1;
			continue;
		}
		if (source >= packedSize) break;
		let offset: number;
		let count: number;
		const control = input[source++] ?? 0;
		if (control >= LZSS_LONG) {
			offset = (input[source++] ?? 0) | ((control & LZSS_LONG_MASK) << 8);
			count =
				LZSS_COUNT_BASE + ((control >> LZSS_LONG_SHIFT) & LZSS_LONG_COUNT);
		} else if (0 !== (control & LZSS_SHORT)) {
			offset = control & LZSS_SHORT_MASK;
			count =
				LZSS_PAIR_BASE + ((control >> LZSS_SHORT_SHIFT) & LZSS_SHORT_COUNT);
			if (0 === offset) {
				offset = input[source++] ?? 0;
			}
		} else if (LZSS_LONG_LENGTH === control) {
			count = LZSS_PAIR_BASE + input.readUInt16LE(source);
			offset = input.readUInt16LE(source + 2);
			source += 4;
		} else {
			offset = input.readUInt16LE(source);
			source += 2;
			count = control + LZSS_COUNT_BASE;
		}
		copyOverlapped(output, destination - offset, destination, count);
		destination += count;
	}
}

/** `sub_4121C0`'s first two loops: the places of a frame, put back in the order they were read in. */
export function interleavePcmFrame(
	input: Buffer,
	at: number,
	window: Buffer,
): void {
	let source = at;
	let target = 1;
	for (let i = 0; i < INPUT_HALF; i += 1) {
		window[target] = input[source++] ?? 0;
		target += 2;
	}
	target = 0;
	for (let i = 0; i < INPUT_QUARTER; i += 1) {
		const low = input[source + INPUT_QUARTER] ?? 0;
		const high = input[source] ?? 0;
		window[target] = ((low >> 4) | (high & 0xf0)) & 0xff;
		window[target + 2] = ((high << 4) | (low & 0x0f)) & 0xff;
		target += 4;
		source += 1;
	}
}

/** `sub_4121C0`'s last loop: the window of a frame, scaled by the scales of its kind. */
export function scalePcmWindow(
	window: Buffer,
	extra: number,
	data: Int32Array,
	temp: Int32Array,
): void {
	const scales = SCALES[extra] ?? SCALES[0] ?? [];
	let index = 0;
	let at = 0;
	for (let place = 0; place < SCALE_PLACES; place += 16) {
		// The reference divides the place of its own loop by a whole count, so the scale it picks
		// only changes every `SCALE_STEP / 16` places.
		const scale = scales[(place / SCALE_STEP) | 0] ?? 0;
		const first = window.readUInt16LE(at);
		const second = window.readUInt16LE(at + 2);
		data[index] = Math.imul(scale, pcmCodedValue(first));
		temp[index] = Math.imul(scale, pcmCodedValue(second));
		index += 1;
		at += 4;
	}
	for (let i = index; i < CODE_COUNT; i += 1) {
		data[i] = 0;
		temp[i] = 0;
	}
}

/**
 * `PcmDecoder.sub_411AB0 (12, a2, a3)`: the transform of a frame, in place. The names of the places below
 * are the ones the reference walks with, since every one of them is part of its arithmetic.
 */
export function transformPcmFrame(data: Int32Array, temp: Int32Array): void {
	if (TRANSFORM_BITS < 3) return;
	const size = 1 << TRANSFORM_BITS;
	let v4 = size;
	let v5 = 1;
	let v68 = 1;
	let v6 = size;
	const v79 = size;
	let v7 = v4 >> 1;
	let v59 = TRANSFORM_LEVELS;
	for (;;) {
		const v63 = v4;
		const v82 = TWIDDLE[TWIDDLE_BASE * v5] ?? 0;
		const v66 = v7;
		let v8 = v7 >> 1;
		const v62 = v7 >> 1;
		const v80 = TWIDDLE[1 + TWIDDLE_BASE * v5] ?? 0;
		let v77 = 0;
		if (v6 > 0) {
			let v73 = 0;
			let v69 = v8;
			let v75 = v7;
			let v64 = v8 + 1;
			const v10 = v7 + v8;
			let v11 = 1;
			let v12 = v10 + 1;
			let v71 = v10;
			let v13 = v7 + 1;
			do {
				const v14 = data[v75] ?? 0;
				const v15 = data[v73] ?? 0;
				const v16 = (temp[v11 - 1] ?? 0) - (temp[v13 - 1] ?? 0);
				data[v73] = ((data[v73] ?? 0) + (data[v75] ?? 0)) | 0;
				temp[v11 - 1] = ((temp[v11 - 1] ?? 0) + (temp[v13 - 1] ?? 0)) | 0;
				data[v75] = (v15 - v14) | 0;
				temp[v13 - 1] = v16;
				const v17 = data[v13] ?? 0;
				const v18 = ((data[v11] ?? 0) - v17) | 0;
				const v19 = ((temp[v11] ?? 0) - (temp[v13] ?? 0)) | 0;
				data[v11] = ((data[v11] ?? 0) + v17) | 0;
				temp[v11] = ((temp[v11] ?? 0) + (temp[v13] ?? 0)) | 0;
				data[v13] = (shiftTwiddle(v18, v82) + shiftTwiddle(v19, v80)) | 0;
				temp[v13] = (shiftTwiddle(v19, v82) - shiftTwiddle(v18, v80)) | 0;
				const v20 = ((data[v69] ?? 0) - (data[v71] ?? 0)) | 0;
				const v21 = v64;
				const v22 = (temp[v64 - 1] ?? 0) - (temp[v12 - 1] ?? 0);
				data[v69] = ((data[v69] ?? 0) + (data[v71] ?? 0)) | 0;
				temp[v21 - 1] = ((temp[v21 - 1] ?? 0) + (temp[v12 - 1] ?? 0)) | 0;
				data[v71] = v22;
				temp[v12 - 1] = -v20 | 0;
				const v23 = data[v12] ?? 0;
				const v24 = ((data[v64] ?? 0) - v23) | 0;
				const v25 = ((temp[v64] ?? 0) - (temp[v12] ?? 0)) | 0;
				data[v21] = ((data[v21] ?? 0) + v23) | 0;
				temp[v21] = ((temp[v21] ?? 0) + (temp[v12] ?? 0)) | 0;
				data[v12] = (shiftTwiddle(v25, v82) - shiftTwiddle(v24, v80)) | 0;
				temp[v12] = -(shiftTwiddle(v24, v82) + shiftTwiddle(v25, v80)) | 0;
				v13 += v63;
				v75 += v63;
				v11 += v63;
				v73 += v63;
				v12 += v63;
				v71 += v63;
				v77 += v63;
				v69 += v63;
				v64 += v63;
			} while (v77 < v79);
			v8 = v62;
			v5 = v68;
			v7 = v66;
			v6 = size;
		}
		if (v8 > 2) {
			let v70 = 2;
			let v72 = v7 + 2;
			let v74 = v8 + 2;
			let v27 = 1 + 4 * v5;
			let v60 = v8 - 2;
			let v76 = v8 + 2 + v7;
			do {
				const v83 = TWIDDLE[v27 - 1] ?? 0;
				const v81 = TWIDDLE[v27] ?? 0;
				let v78 = 0;
				if (v6 > 0) {
					let v28 = v70;
					let v29 = v72;
					let v65 = v74;
					let v85 = v76;
					do {
						const v31 = data[v29] ?? 0;
						const v32 = ((data[v28] ?? 0) - v31) | 0;
						const v33 = ((temp[v28] ?? 0) - (temp[v29] ?? 0)) | 0;
						data[v28] = ((data[v28] ?? 0) + v31) | 0;
						temp[v28] = ((temp[v28] ?? 0) + (temp[v29] ?? 0)) | 0;
						data[v29] = (shiftTwiddle(v32, v83) + shiftTwiddle(v33, v81)) | 0;
						temp[v29] = (shiftTwiddle(v33, v83) - shiftTwiddle(v32, v81)) | 0;
						const v34 = ((data[v65] ?? 0) - (data[v85] ?? 0)) | 0;
						const v35 = ((temp[v65] ?? 0) - (temp[v85] ?? 0)) | 0;
						data[v65] = ((data[v65] ?? 0) + (data[v85] ?? 0)) | 0;
						temp[v65] = ((temp[v65] ?? 0) + (temp[v85] ?? 0)) | 0;
						data[v85] = (shiftTwiddle(v35, v83) - shiftTwiddle(v34, v81)) | 0;
						temp[v85] = -(shiftTwiddle(v34, v83) + shiftTwiddle(v35, v81)) | 0;
						v29 += v63;
						v85 += v63;
						v28 += v63;
						v65 += v63;
						v78 += v63;
					} while (v78 < v79);
					v5 = v68;
					v6 = size;
				}
				v27 += 2 * v5;
				v70 += 1;
				v72 += 1;
				v74 += 1;
				v76 += 1;
			} while (v60-- !== 1);
		}
		v68 = 2 * v5;
		v59 -= 1;
		if (0 === v59) break;
		v7 = v62;
		v5 *= 2;
		v4 = v66;
	}
	if (!(TRANSFORM_BITS < TRANSFORM_PAIR || v6 <= 0)) {
		let v37 = 1;
		let v38 = 3;
		let v88 = (v6 + 3) >> TRANSFORM_PAIR;
		do {
			const v39 = data[v37 - 1] ?? 0;
			const v40 = data[v37 + 1] ?? 0;
			const v41 = (temp[v38 - 3] ?? 0) - (temp[v38 - 1] ?? 0);
			data[v37 - 1] = (v40 + v39) | 0;
			v37 += TRANSFORM_BLOCK;
			temp[v38 - 3] = ((temp[v38 - 3] ?? 0) + (temp[v38 - 1] ?? 0)) | 0;
			data[v37 - 3] = (v39 - v40) | 0;
			temp[v38 - 1] = v41;
			const v42 = data[v38] ?? 0;
			const v43 = (temp[v38 - 2] ?? 0) - (temp[v38] ?? 0);
			v38 += TRANSFORM_BLOCK;
			const v44 = (data[v37 - 4] ?? 0) - v42;
			data[v37 - 4] = ((data[v37 - 4] ?? 0) + v42) | 0;
			temp[v38 - 6] = ((temp[v38 - 6] ?? 0) + (temp[v38 - 4] ?? 0)) | 0;
			data[v38 - 4] = v43;
			temp[v38 - 4] = -v44 | 0;
			v88 -= 1;
		} while (0 !== v88);
		v6 = v79;
	}
	let v45 = 0;
	if (v6 > 0) {
		let v47 = 1;
		let v89 = (v79 + 1) >> TRANSFORM_WHOLE;
		do {
			const v48 = data[v47] ?? 0;
			const v49 = (temp[v47 - 1] ?? 0) - (temp[v47] ?? 0);
			const v50 = (data[v45] ?? 0) - v48;
			v47 += TRANSFORM_PAIR;
			data[v45] = ((data[v45] ?? 0) + v48) | 0;
			v45 += TRANSFORM_PAIR;
			temp[v47 - 3] = ((temp[v47 - 3] ?? 0) + (temp[v47 - 2] ?? 0)) | 0;
			data[v47 - 2] = v50;
			temp[v47 - 2] = v49;
			v89 -= 1;
		} while (0 !== v89);
		v45 = 0;
		v6 = v79;
	}
	let v51 = 0;
	let result = v6 / TRANSFORM_PAIR;
	const v67 = v6 / TRANSFORM_PAIR;
	let v90 = 1;
	if (v6 - 1 > 1) {
		let v54 = 1;
		for (;;) {
			for (; result <= v51; result /= TRANSFORM_PAIR) {
				v51 -= result;
			}
			v51 += result;
			if (v90 < v51) {
				const v55 = data[v45 + v51] ?? 0;
				data[v45 + v51] = data[v54] ?? 0;
				data[v54] = v55;
				const v56 = temp[v51] ?? 0;
				temp[v51] = temp[v54] ?? 0;
				temp[v54] = v56;
			}
			v54 += 1;
			result = v79 - 1;
			v90 += 1;
			if (v90 >= v79 - 1) break;
			result = v67;
		}
		v6 = v79;
	}
	while (v6 > 0) {
		const eax = ((data[v45] ?? 0) << OUTPUT_SHIFT) | 0;
		const edx = eax < 0 ? OUTPUT_MASK : 0;
		data[v45] = (eax + edx) >> SHIFT_OUTPUT;
		v45 += 1;
		v6 -= 1;
	}
}

/** `PcmDecoder.DecodeV1` (`sub_4122B0`): the frames of a walked stream, turned into samples. */
export function decodePcmStream(
	encoded: Buffer,
	pcmSize: number,
	extra: number,
): Buffer {
	const output = Buffer.alloc(pcmSize + DECODED_STEP + OVERLAP_COUNT, 0);
	const window = Buffer.alloc(INPUT_HALF * TRANSFORM_PAIR, 0);
	const data = new Int32Array(CODE_COUNT);
	const temp = new Int32Array(CODE_COUNT);
	const samples = Math.floor(pcmSize / TRANSFORM_PAIR);
	let source = 0;
	let decoded = 0;
	for (let frame = 0; frame < samples; frame += SAMPLE_COUNT) {
		interleavePcmFrame(encoded, source, window);
		source += FRAME_STEP;
		scalePcmWindow(window, extra, data, temp);
		transformPcmFrame(data, temp);
		let at = decoded;
		let index = 0;
		let place = 0;
		for (let overlap = OVERLAP_COUNT; overlap > -SAMPLE_COUNT; overlap -= 1) {
			if (place + frame < samples) {
				let value: number;
				if (overlap > 0 && 0 !== frame) {
					// The reference mixes the places of this frame with the samples the frame before it
					// left in the tail of the output: `v7` and the frame's own `v9` are its two weights.
					const product =
						place * ((data[index] ?? 0) >>> 0) +
						overlap * output.readInt16LE(at);
					const high = Math.floor(product / INT32) & HIGH_MASK;
					value = ((high + (product | 0)) | 0) >> 5;
				} else {
					value = data[index] ?? 0;
				}
				if (value > SAMPLE_MAX) value = SAMPLE_MAX;
				else if (value < SAMPLE_MIN) value = SAMPLE_MIN;
				output.writeInt16LE(value, at);
			}
			place += 1;
			at += TRANSFORM_PAIR;
			index += 1;
		}
		decoded += DECODED_STEP;
	}
	return output.subarray(0, pcmSize);
}

/** The count of the places of the walked stream of a sound, as the reference sizes its buffer. */
export function walkedStreamSize(pcmSize: number): number {
	return Math.floor(pcmSize / SAMPLE_COUNT) * CODE_COUNT + 16386;
}
