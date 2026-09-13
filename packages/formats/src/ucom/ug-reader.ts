// Codec reference: GARbro "Legacy/Ucom/ImageUG.cs", class `UgReader` (the vertical scanline variant of the
// System98 bit-packed decoder). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GraBaseReader, type GraGeometry } from "../system98/gra-reader.js";

/**
 * The geometry the reference derives from twice the height instead of the width. The ring is three times
 * `height << 2` bytes rather than six times the row length, the opening fill writes one more pair than a
 * row, and the write cursor starts two rows in. `rowBytes`, `previousRow` and `fillCount` are not used by
 * the vertical loop, which computes its own offsets, but they are set to the matching values so the object
 * describes the buffer it allocates.
 */
export function verticalGeometry(width: number, height: number): GraGeometry {
	return {
		rowBytes: height << 1,
		bufferBytes: (height << 2) * 3,
		initialDst: height << 2,
		previousRow: -(height << 1),
		fillCount: (height << 1) + 1,
		stride: width >> 1,
		pixelBytes: (width >> 1) * height,
	};
}

/**
 * The same algorithm as the horizontal reader with the axes swapped. The differences from the base are
 * confined to two places in the loop and the flush: the source selection uses plus four, minus four or a
 * doubling instead of a doubling and plus or minus one, the run-length branch performs a single copy
 * instead of walking the wrap boundary, and the flush reads four words per output row at a stride of the
 * height and shifts the ring by `height << 3` bytes when it is done.
 */
export class UgGraReader extends GraBaseReader {
	private readonly height: number;

	constructor(
		input: Uint8Array,
		offset: number,
		width: number,
		height: number,
	) {
		super(input, offset, verticalGeometry(width, height));
		this.height = height;
	}

	protected override unpackBitsInternal(): void {
		const height = this.height;
		const hTimes2 = height << 1;
		const hTimes4 = height << 2;
		const bufferSize = hTimes4 * 3;
		this.buffer.fill(0);
		this.dst = 0;
		this.initFrame();
		let p = this.readPair(0);
		for (let i = 0; i < hTimes2 + 1; i += 1) this.setPair(i, p);
		let dst = hTimes4;
		let prevSrc = 0;
		while (this.dst < this.pixels.length) {
			let sameLine = false;
			let src = -hTimes2;
			if (this.getNextBit() !== 0) {
				if (this.getNextBit() === 0) {
					src += 4;
				} else {
					if (this.getNextBit() === 0) src -= 4;
					else src <<= 1;
				}
			} else {
				if (this.getNextBit() === 0) {
					src = -4;
					p = this.pairAt((dst >> 1) - 1);
					if ((p & 0xff) === p >> 8) sameLine = src !== prevSrc;
				}
			}
			if (src !== prevSrc) {
				prevSrc = src;
				if (!sameLine) src += dst;
				else src = dst - 2;
				if (this.getNextBit() !== 0) {
					let bitLength = 0;
					do {
						bitLength += 1;
					} while (this.getNextBit() !== 0);
					let count = 1;
					while (bitLength-- > 0) count = (count << 1) | this.getNextBit();
					this.movePixels(src, dst, count);
					dst += count << 1;
					if (dst === bufferSize) {
						if (this.flushBuffer()) return;
						dst = hTimes4;
					}
				} else {
					this.movePixels(src, dst, 1);
					dst += 2;
					if (dst === bufferSize) {
						if (this.flushBuffer()) return;
						dst = hTimes4;
					}
				}
			} else {
				p = this.pairAt((dst >> 1) - 1);
				do {
					const prev = (p >> 8) & 0xff;
					p = this.readPair(prev);
					this.setPair(dst >> 1, p);
					dst += 2;
					if (dst === bufferSize) {
						if (this.flushBuffer()) return;
						dst = hTimes4;
					}
				} while (this.getNextBit() !== 0);
				prevSrc = 0;
			}
		}
	}

	protected override flushBuffer(): boolean {
		const height = this.height;
		let srcLine = height << 1;
		let dst = this.dst;
		for (let i = 0; i < height; i += 1) {
			let src = srcLine;
			for (let j = 0; j < 4; j += 1) {
				const p = this.pairAt(src);
				this.pixels[dst + j] = ((p & 0xf0) | (p >> 12)) & 0xff;
				src += height;
			}
			srcLine += 1;
			dst += this.stride;
		}
		this.dst += 4;
		this.movePixels(height << 3, 0, height << 1);
		return this.dst >= this.stride;
	}
}
