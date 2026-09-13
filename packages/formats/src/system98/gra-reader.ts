// Codec reference: GARbro "Legacy/System98/ImageG.cs", class `GraBaseReader` (shared by the System98,
// Desire DES/DPC, Tiare GRA and Ucom UG image formats). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The port keeps the reference's arithmetic verbatim, including the unit mixing that makes it work: the
// pair buffer is addressed by *byte* offsets while the copy counts are *element* counts, which is why
// `movePixels` doubles its count before copying. Copies can start at an odd byte offset (the `-width ± 1`
// sources), so the buffer has to be byte addressable with a pair view on top rather than a plain array.

/** Thrown when the compressed stream runs out; `unpackBits` turns this into a partial image. */
export class GraEndOfStream extends Error {
	constructor() {
		super("Gra stream ended");
		this.name = "GraEndOfStream";
	}
}

/**
 * The geometry-dependent constants of the decoder. The horizontal variant used by System98, Desire and
 * Tiare derives everything from the width; the vertical variant used by Ucom derives it from twice the
 * height, which is why they are parameters rather than computed in place.
 */
export interface GraGeometry {
	/** Length of one buffer row in bytes. */
	rowBytes: number;
	/** Bytes in the whole ring buffer. */
	bufferBytes: number;
	/** Byte offset the write cursor starts at and wraps to. */
	initialDst: number;
	/** Symbolic source offset meaning "one row back". */
	previousRow: number;
	/** Number of pairs the opening fill writes. */
	fillCount: number;
	/** Pixel stride of the output, in bytes. */
	stride: number;
	/** Output pixel buffer size, in bytes. */
	pixelBytes: number;
}

export function horizontalGeometry(width: number, height: number): GraGeometry {
	return {
		rowBytes: width << 1,
		bufferBytes: (width << 2) + (width << 1),
		initialDst: width << 1,
		previousRow: -width,
		fillCount: width,
		stride: width >> 1,
		pixelBytes: (width >> 1) * height,
	};
}

/**
 * An MSB-first bit reader over a byte range. Where the reference throws `EndOfStreamException` from
 * `ReadUInt8`, this throws `GraEndOfStream`; the callers rely on catching it and flushing what has been
 * decoded so far, so it must not be reported as zero bits.
 */
class GraBitReader {
	private readonly input: Uint8Array;
	private readonly end: number;
	private position: number;
	private bits = 0;
	private bitCount = 1;

	constructor(input: Uint8Array, offset: number) {
		this.input = input;
		this.position = offset;
		this.end = input.length;
	}

	getNextBit(): number {
		this.bitCount -= 1;
		if (this.bitCount <= 0) {
			if (this.position >= this.end) throw new GraEndOfStream();
			this.bits = this.input[this.position++] ?? 0;
			this.bitCount = 8;
		}
		const bit = (this.bits >> 7) & 1;
		this.bits = (this.bits << 1) & 0xff;
		return bit;
	}
}

export class GraBaseReader {
	protected readonly geometry: GraGeometry;
	protected readonly reader: GraBitReader;
	/** The ring buffer, as bytes, with a pair view for the aligned accesses the reference makes. */
	protected buffer = new Uint8Array(0);
	protected pairView = new Uint16Array(0);
	private frame = new Uint8Array(0x100);
	/** Pixel write position, which is what the reference calls `m_dst`. */
	protected dst = 0;
	readonly pixels: Uint8Array;
	readonly stride: number;

	constructor(input: Uint8Array, offset: number, geometry: GraGeometry) {
		this.geometry = geometry;
		this.reader = new GraBitReader(input, offset);
		this.stride = geometry.stride;
		this.pixels = new Uint8Array(geometry.pixelBytes);
		this.buffer = new Uint8Array(geometry.bufferBytes);
		this.pairView = new Uint16Array(
			this.buffer.buffer,
			this.buffer.byteOffset,
			geometry.bufferBytes >> 1,
		);
	}

	/** The reference's `UnpackBits`: a truncated stream leaves the rest of the image zeroed. */
	unpackBits(): Uint8Array {
		try {
			this.unpackBitsInternal();
		} catch (error) {
			if (!(error instanceof GraEndOfStream)) throw error;
			this.flushBuffer();
		}
		return this.pixels;
	}

	protected getNextBit(): number {
		return this.reader.getNextBit();
	}

	/** Exposed for unit tests; the decoder's bit source is the only way to drive its branches. */
	protected getNextBitForTest(): number {
		return this.getNextBit();
	}

	/**
	 * `ReadPair` reads the low nibble's position first and then passes the byte it just decoded as the
	 * position for the high nibble, because the frame is an adaptive strip indexed by the previous byte.
	 */
	protected readPair(pos: number): number {
		const al = this.readPixel(pos);
		const ah = this.readPixel(al);
		return (al | (ah << 8)) & 0xffff;
	}

	/** Reads a frame byte, which may shift the frame strip or swap two adjacent entries. */
	protected readPixel(pos: number): number {
		let px = 0;
		// Each condition reads its own bit, so the tests below are not repetitions of one another; naming
		// the bits keeps that explicit and keeps the reads in the reference's order.
		if (this.getNextBit() === 0) {
			let count = 1;
			if (this.getNextBit() !== 0) {
				if (this.getNextBit() !== 0) {
					count = (count << 1) | this.getNextBit();
				}
				count = (count << 1) | this.getNextBit();
			}
			count = (count << 1) | this.getNextBit();
			pos += count;
			px = this.frameAt(pos);
			pos -= 1;
			while (count-- > 0) {
				this.setFrame(pos + 1, this.frameAt(pos));
				pos -= 1;
			}
			this.setFrame(pos + 1, px);
		} else {
			if (this.getNextBit() === 0) {
				px = this.frameAt(pos);
			} else {
				px = this.frameAt(pos + 1);
				this.setFrame(pos + 1, this.frameAt(pos));
				this.setFrame(pos, px);
			}
		}
		return px;
	}

	/**
	 * The frame starts as sixteen descending nibble runs, each sixteen entries long: zero, `0xF0`, `0xE0`
	 * and so on, with the next run starting sixteen higher.
	 */
	protected initFrame(): void {
		this.frame = new Uint8Array(0x100);
		let p = 0;
		let a = 0;
		for (let j = 0; j < 0x10; j += 1) {
			for (let i = 0; i < 0x10; i += 1) {
				this.frame[p++] = a;
				a = (a - 0x10) & 0xff;
			}
			a = (a + 0x10) & 0xff;
		}
	}

	/**
	 * A block copy over the pair buffer, addressed in bytes while the count is in elements, exactly as the
	 * reference calls `Buffer.BlockCopy`. Overlapping copies move forward in chunks no larger than the
	 * distance between source and destination.
	 */
	protected movePixels(src: number, dst: number, countElements: number): void {
		let count = countElements << 1;
		if (dst > src) {
			const s = src;
			let d = dst;
			while (count > 0) {
				const preceding = Math.min(d - s, count);
				this.buffer.copyWithin(d, s, s + preceding);
				d += preceding;
				count -= preceding;
			}
		} else {
			this.buffer.copyWithin(dst, src, src + count);
		}
	}

	/**
	 * Emits up to two rows of pixels and moves the tail of the ring down; returns true once the image is
	 * complete, which is what stops the decoder.
	 */
	protected flushBuffer(): boolean {
		const { rowBytes } = this.geometry;
		this.movePixels(rowBytes << 1, 0, rowBytes >> 1);
		let src = rowBytes >> 1;
		let count = Math.min(rowBytes, this.pixels.length - this.dst);
		while (count-- > 0) {
			const p = this.pairAt(src);
			src += 1;
			this.pixels[this.dst] = ((p & 0xf0) | (p >> 12)) & 0xff;
			this.dst += 1;
		}
		return this.dst === this.pixels.length;
	}

	protected frameAt(index: number): number {
		const value = this.frame[index];
		if (value === undefined)
			throw new RangeError("Gra frame index out of range");
		return value;
	}

	protected setFrame(index: number, value: number): void {
		if (index < 0 || index >= this.frame.length)
			throw new RangeError("Gra frame index out of range");
		this.frame[index] = value;
	}

	protected pairAt(index: number): number {
		const value = this.pairView[index];
		if (value === undefined)
			throw new RangeError("Gra buffer index out of range");
		return value;
	}

	protected setPair(index: number, value: number): void {
		if (index < 0 || index >= this.pairView.length)
			throw new RangeError("Gra buffer index out of range");
		this.pairView[index] = value;
	}

	protected unpackBitsInternal(): void {
		const { rowBytes, bufferBytes, initialDst, previousRow, fillCount } =
			this.geometry;
		// The pair view shares the buffer's storage, so byte level copies are visible through it.
		this.buffer.fill(0);
		this.dst = 0;
		this.initFrame();
		let p = this.readPair(0);
		for (let i = 0; i < fillCount; i += 1) this.setPair(i, p);
		let dst = initialDst;
		let prevSrc = 0;
		while (this.dst < this.pixels.length) {
			let sameLine = false;
			let src = previousRow;
			if (this.getNextBit() !== 0) {
				if (this.getNextBit() === 0) {
					src <<= 1;
				} else {
					if (this.getNextBit() === 0) src += 1;
					else src -= 1;
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
					let remaining = (bufferBytes - dst) >> 1;
					while (count > remaining) {
						count -= remaining;
						this.movePixels(src, dst, remaining);
						src += remaining << 1;
						if (this.flushBuffer()) return;
						dst = initialDst;
						src -= rowBytes << 1;
						remaining = (rowBytes << 1) >> 1;
					}
					this.movePixels(src, dst, count);
					dst += count << 1;
					if (dst === bufferBytes) {
						if (this.flushBuffer()) return;
						dst = initialDst;
					}
				} else {
					this.movePixels(src, dst, 1);
					dst += 2;
					if (dst === bufferBytes) {
						if (this.flushBuffer()) return;
						dst = initialDst;
					}
				}
			} else {
				p = this.pairAt((dst >> 1) - 1);
				do {
					const prev = (p >> 8) & 0xff;
					p = this.readPair(prev);
					this.setPair(dst >> 1, p);
					dst += 2;
					if (dst === bufferBytes) {
						if (this.flushBuffer()) return;
						dst = initialDst;
					}
				} while (this.getNextBit() !== 0);
				prevSrc = 0;
			}
		}
	}
}
