// Block decoder shared by the ports that read a picture of the compressed kinds of DirectDraw — the two
// kinds of colour of the first kind, the third and the fifth — and hand it out four bytes a pixel.
//
// Reference: GARbro "ArcFormats/DirectDraw/DxtDecoder.cs", class `DxtDecoder`. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// Every kind of a block is four by four pixels: the first kind is a word of two colours of five, six and
// five bits with two places of interpolation between them and a word of two places a pixel saying which of
// the four it takes, the third stands the same colours behind sixteen places of alpha of four bits, and the
// fifth stands two places of alpha of their own in front of them with three places a pixel of their own.
// What is written out is the byte order a bitmap of four bytes a pixel holds, four bytes a pixel.

/** The side of a block, every kind of them being four by four pixels. */
export const DXT_BLOCK_SIZE = 4;
/** The bytes of a block of the first kind, against sixteen for the third and the fifth. */
export const DXT1_BLOCK_BYTES = 8;
export const DXT_BLOCK_BYTES = 16;

/** `ReadDXT1Color`: a word of five, six and five bits spread out to three bytes and an opaque fourth. */
function readDxt1Color(
	input: Buffer,
	src: number,
	idx: number,
	colour: Uint8Array,
): void {
	const low = input[src] ?? 0;
	const high = input[src + 1] ?? 0;
	const blue = low & 0x1f;
	const green = ((low >> 5) | (high << 3)) & 0x3f;
	const red = high >> 3;
	colour[idx] = ((blue << 3) | (blue >> 2)) & 0xff;
	colour[idx + 1] = ((green << 2) | (green >> 4)) & 0xff;
	colour[idx + 2] = ((red << 3) | (red >> 2)) & 0xff;
	colour[idx + 3] = 0xff;
}

/**
 * `DecompressDXT1Block`: the two colours of the block and then, where the second of them stands above the
 * first, two places of interpolation between them, or, where it does not, one place of interpolation and a
 * fourth colour of nought that lets the pixels see through — the walk of the kind of picture that carries
 * alpha in the first kind of block. Every pixel takes one of the four by two places of the word behind them.
 */
export function decompressDxt1Block(
	input: Buffer,
	src: number,
	output: Buffer,
	stride: number,
	blockY: number,
	blockX: number,
	height: number,
	width: number,
): void {
	const colour = new Uint8Array(16);
	readDxt1Color(input, src, 0, colour);
	readDxt1Color(input, src + 2, 4, colour);
	const hasAlpha =
		(colour[0] ?? 0) <= (colour[4] ?? 0) &&
		(colour[1] ?? 0) <= (colour[5] ?? 0) &&
		(colour[2] ?? 0) <= (colour[6] ?? 0);
	interpolate(colour, hasAlpha);
	drawBlock(
		input,
		src + 4,
		output,
		stride,
		blockY,
		blockX,
		height,
		width,
		colour,
		undefined,
	);
}

/** The two places of interpolation of the first and the third kind, and the fourth colour of the first. */
function interpolate(colour: Uint8Array, hasAlpha: boolean): void {
	for (let index = 0; index < 4; index += 1) {
		const first = colour[index] ?? 0;
		const second = colour[4 + index] ?? 0;
		if (hasAlpha) {
			colour[8 + index] = (first + second) >> 1;
			colour[12 + index] = 0;
		} else {
			colour[8 + index] = Math.floor(((first << 1) + second) / 3);
			colour[12 + index] = Math.floor(((second << 1) + first) / 3);
		}
	}
}

/**
 * The pixels of a block: two places of the word every one of them takes, and, where the block carries a walk
 * of alpha of its own, the alpha that walk gives the pixel.
 */
function drawBlock(
	input: Buffer,
	mapAt: number,
	output: Buffer,
	stride: number,
	blockY: number,
	blockX: number,
	height: number,
	width: number,
	colour: Uint8Array,
	alpha: Uint8Array | undefined,
): void {
	let map = input.readUInt32LE(mapAt);
	for (let y = 0; y < DXT_BLOCK_SIZE && blockY + y < height; y += 1) {
		for (let x = 0; x < DXT_BLOCK_SIZE && blockX + x < width; x += 1) {
			const at = (map & 3) * 4;
			const dst = stride * (blockY + y) + (blockX + x) * 4;
			output[dst] = colour[at] ?? 0;
			output[dst + 1] = colour[at + 1] ?? 0;
			output[dst + 2] = colour[at + 2] ?? 0;
			output[dst + 3] = alpha
				? (alpha[y * DXT_BLOCK_SIZE + x] ?? 0)
				: (colour[at + 3] ?? 0);
			map >>>= 2;
		}
	}
}

/**
 * `DecompressDXT3Block`: sixteen places of alpha of four bits, spread out over a byte each by taking the
 * place four times over, stand in front of the two colours — and the two colours take the two places of
 * interpolation of the kind of block that has no fourth colour of its own, whatever the two colours are.
 */
export function decompressDxt3Block(
	input: Buffer,
	src: number,
	output: Buffer,
	stride: number,
	blockY: number,
	blockX: number,
	height: number,
	width: number,
): void {
	const alpha = new Uint8Array(16);
	let at = 0;
	for (let index = 0; index < 8; index += 1) {
		const byte = input[src + index] ?? 0;
		alpha[at] = (byte & 0x0f) * 17;
		alpha[at + 1] = (byte >> 4) * 17;
		at += 2;
	}
	const colour = new Uint8Array(16);
	readDxt1Color(input, src + 8, 0, colour);
	readDxt1Color(input, src + 10, 4, colour);
	interpolate(colour, false);
	drawBlock(
		input,
		src + 12,
		output,
		stride,
		blockY,
		blockX,
		height,
		width,
		colour,
		alpha,
	);
}

/** `DecompressDXT5Alpha`: sixteen places of alpha of three bits, the first eight from three bytes and the
 *  second eight from the three behind them. */
function readDxt5AlphaCodes(
	input: Buffer,
	src: number,
	codes: Uint8Array,
): void {
	let at = 0;
	for (let half = 0; half < 2; half += 1) {
		let block = input[src + half * 3] ?? 0;
		block |= (input[src + half * 3 + 1] ?? 0) << 8;
		block |= (input[src + half * 3 + 2] ?? 0) << 16;
		for (let index = 0; index < 8; index += 1) {
			codes[at] = block & 7;
			at += 1;
			block >>>= 3;
		}
	}
}

/**
 * `DecompressDXT5Block`: two places of alpha of a byte each stand in front of the colours, with sixteen
 * places of three bits between them saying which of eight steps a pixel takes — the two given ones, six
 * steps spread between them where the first stands above the second, or, where it does not, four steps
 * spread between them and the two places of nought and of the whole.
 */
export function decompressDxt5Block(
	input: Buffer,
	src: number,
	output: Buffer,
	stride: number,
	blockY: number,
	blockX: number,
	height: number,
	width: number,
): void {
	const alpha0 = input[src] ?? 0;
	const alpha1 = input[src + 1] ?? 0;
	const codes = new Uint8Array(16);
	readDxt5AlphaCodes(input, src + 2, codes);
	const color0 = input.readUInt16LE(src + 8);
	const color1 = input.readUInt16LE(src + 10);
	let value = ((color0 >> 11) * 255 + 16) | 0;
	const red0 = Math.floor(Math.floor(value / 32 + value) / 32);
	value = (((color0 & 0x07e0) >> 5) * 255 + 32) | 0;
	const green0 = Math.floor(Math.floor(value / 64 + value) / 64);
	value = ((color0 & 0x001f) * 255 + 16) | 0;
	const blue0 = Math.floor(Math.floor(value / 32 + value) / 32);
	value = ((color1 >> 11) * 255 + 16) | 0;
	const red1 = Math.floor(Math.floor(value / 32 + value) / 32);
	value = (((color1 & 0x07e0) >> 5) * 255 + 32) | 0;
	const green1 = Math.floor(Math.floor(value / 64 + value) / 64);
	value = ((color1 & 0x001f) * 255 + 16) | 0;
	const blue1 = Math.floor(Math.floor(value / 32 + value) / 32);
	let code = input.readUInt32LE(src + 12);
	for (let y = 0; y < DXT_BLOCK_SIZE && blockY + y < height; y += 1) {
		for (let x = 0; x < DXT_BLOCK_SIZE && blockX + x < width; x += 1) {
			const alphaCode = codes[y * DXT_BLOCK_SIZE + x] ?? 0;
			let alpha: number;
			if (0 === alphaCode) alpha = alpha0;
			else if (1 === alphaCode) alpha = alpha1;
			else if (alpha0 > alpha1) {
				alpha = Math.floor(
					((8 - alphaCode) * alpha0 + (alphaCode - 1) * alpha1) / 7,
				);
			} else if (6 === alphaCode) alpha = 0;
			else if (7 === alphaCode) alpha = 0xff;
			else {
				alpha = Math.floor(
					((6 - alphaCode) * alpha0 + (alphaCode - 1) * alpha1) / 5,
				);
			}
			const dst = stride * (blockY + y) + (blockX + x) * 4;
			let red: number;
			let green: number;
			let blue: number;
			switch (code & 3) {
				case 0:
					red = red0;
					green = green0;
					blue = blue0;
					break;
				case 1:
					red = red1;
					green = green1;
					blue = blue1;
					break;
				case 2:
					red = Math.floor((2 * red0 + red1) / 3);
					green = Math.floor((2 * green0 + green1) / 3);
					blue = Math.floor((2 * blue0 + blue1) / 3);
					break;
				default:
					red = Math.floor((red0 + 2 * red1) / 3);
					green = Math.floor((green0 + 2 * green1) / 3);
					blue = Math.floor((blue0 + 2 * blue1) / 3);
					break;
			}
			output[dst] = blue;
			output[dst + 1] = green;
			output[dst + 2] = red;
			output[dst + 3] = alpha;
			code >>>= 2;
		}
	}
}

/**
 * `DxtDecoder.UnpackDXT1`, `UnpackDXT3` and `UnpackDXT5`: every block of the picture, a row of blocks at a
 * time, handed to the walk of its kind. The blocks of the first kind stand eight bytes apart and those of the
 * other two sixteen.
 */
function unpackDxt(
	input: Buffer,
	width: number,
	height: number,
	blockBytes: number,
	at: (
		input: Buffer,
		src: number,
		output: Buffer,
		stride: number,
		blockY: number,
		blockX: number,
		height: number,
		width: number,
	) => void,
): Buffer {
	const stride = width * 4;
	const output: Buffer = Buffer.alloc(stride * height, 0x00);
	let src = 0;
	for (let y = 0; y < height; y += DXT_BLOCK_SIZE) {
		for (let x = 0; x < width; x += DXT_BLOCK_SIZE) {
			at(input, src, output, stride, y, x, height, width);
			src += blockBytes;
		}
	}
	return output;
}

/** The pixels of a picture of the first kind of block. */
export function unpackDxt1(
	input: Buffer,
	width: number,
	height: number,
): Buffer {
	return unpackDxt(input, width, height, DXT1_BLOCK_BYTES, decompressDxt1Block);
}

/** The pixels of a picture of the third kind of block. */
export function unpackDxt3(
	input: Buffer,
	width: number,
	height: number,
): Buffer {
	return unpackDxt(input, width, height, DXT_BLOCK_BYTES, decompressDxt3Block);
}

/** The pixels of a picture of the fifth kind of block. */
export function unpackDxt5(
	input: Buffer,
	width: number,
	height: number,
): Buffer {
	return unpackDxt(input, width, height, DXT_BLOCK_BYTES, decompressDxt5Block);
}
