// Format reference: GARbro "Legacy/Adviz/ImageGIZ2.cs", class `Giz2Reader`. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. A picture of this kind stands walked as four places
// of a picture, every strip of eight places of the picture standing walked as four records of the places of a
// picture: every record holds one place of every place of the picture, and the places of the picture stand
// beside each other in strips.

import { GarbroError } from "@garbro-mcp/core";

/** The words of the head of a picture of this kind stand in the first sixteen places of the file, and the
 * places of the picture stand behind them. */
export const GIZ2_HEADER_SIZE = 0x10;
const PLACE_HEAD_SIZE = 4;
const PLACES_PER_RECORD = 4;
const PLACES_PER_STRIP = 8;

export interface Giz2Layout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	/** The place of a word of the walk of the places of a picture. */
	rleCode: number;
	/** Which of the four records of the places of a picture stand walked. */
	planeMap: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** A place of a picture turned about within its places. */
function rotateLeft(value: number, count: number): number {
	const by = count & 7;
	return ((value << by) | (value >>> (8 - by))) & 0xff;
}

function rotateRight(value: number, count: number): number {
	const by = count & 7;
	return ((value >>> by) | (value << (8 - by))) & 0xff;
}

/** The walk of the places of a picture of the places of a picture, one place of a picture after another. */
class Giz2Reader {
	private readonly data: Buffer;
	private readonly layout: Giz2Layout;
	private position = GIZ2_HEADER_SIZE;
	readonly planes: Buffer[];

	constructor(data: Buffer, layout: Giz2Layout) {
		this.data = data;
		this.layout = layout;
		this.planes = [
			Buffer.alloc(layout.height),
			Buffer.alloc(layout.height),
			Buffer.alloc(layout.height),
			Buffer.alloc(layout.height),
		];
	}

	private readByte(): number {
		if (this.position >= this.data.length)
			throw invalidPicture(
				"The places of a picture stand short of the places they walk",
			);
		const byte = this.data[this.position] ?? 0;
		this.position += 1;
		return byte;
	}

	/**
	 * `Giz2Reader.UnpackPlane`: the places of one record of the places of a picture, walked: a place that
	 * stands as it is written, a run of places of one value, a run of places of two values that stand beside
	 * each other, and a place of the walk that stands as it stands.
	 */
	unpackPlane(plane: Buffer): void {
		const { height, rleCode } = this.layout;
		let dst = 0;
		const put = (value: number): void => {
			if (dst >= plane.length)
				throw invalidPicture(
					"The walk of the places of a picture stands past the places of it",
				);
			plane[dst] = value;
			dst += 1;
		};
		for (let y = 0; y < height; ) {
			const control = this.readByte();
			const code = (control - rleCode) & 0xff;
			if (code === 2) {
				put(this.readByte());
			} else if (code < PLACE_HEAD_SIZE) {
				let value: number;
				if (code === 0) value = 0;
				else if (code === 1) value = 0xff;
				else value = this.readByte();
				let count = ((this.readByte() - 1) & 0xff) + 1;
				y += count;
				while (count > 0) {
					put(value);
					count -= 1;
				}
				continue;
			} else if (code < PLACE_HEAD_SIZE + 3) {
				const first = this.readByte();
				let second = this.readByte();
				let count: number;
				if (code === PLACE_HEAD_SIZE) {
					count = ((second - 1) & 0x7f) + 1;
					second = second < 0x80 ? rotateLeft(first, 1) : rotateRight(first, 1);
				} else if (code === PLACE_HEAD_SIZE + 1) {
					count = ((second - 1) & 0x7f) + 1;
					second = second < 0x80 ? rotateLeft(first, 2) : rotateRight(first, 2);
				} else {
					count = ((this.readByte() - 1) & 0xff) + 1;
					count *= 2;
				}
				y += count;
				do {
					put(first);
					count -= 1;
					if (count <= 0) break;
					put(second);
					count -= 1;
				} while (count > 0);
				continue;
			} else {
				put(control);
			}
			y += 1;
		}
	}

	/**
	 * `Giz2Reader.CopyPlanes`: the places of eight places of a strip of the picture stand beside the places of
	 * the four records of the places of a picture, the first place of a record standing in the places of the
	 * picture that stand in the places above the places behind it.
	 */
	copyPlanes(output: Buffer, stride: number, dst: number): void {
		const [p0, p1, p2, p3] = this.planes;
		for (let y = 0; y < this.layout.height; y += 1) {
			const b0 = p0?.[y] ?? 0;
			const b1 = p1?.[y] ?? 0;
			const b2 = p2?.[y] ?? 0;
			const b3 = p3?.[y] ?? 0;
			for (let j = 0; j < PLACES_PER_STRIP; j += 2) {
				let place =
					((((b0 << j) & 0x80) >>> 3) |
						(((b1 << j) & 0x80) >>> 2) |
						(((b2 << j) & 0x80) >>> 1) |
						((b3 << j) & 0x80)) >>>
					0;
				place |=
					((((b0 << j) & 0x40) >>> 6) |
						(((b1 << j) & 0x40) >>> 5) |
						(((b2 << j) & 0x40) >>> 4) |
						(((b3 << j) & 0x40) >>> 3)) >>>
					0;
				const at = dst + j / 2;
				if (at >= output.length)
					throw invalidPicture(
						"The places of a picture stand past the places of it",
					);
				output[at] = place & 0xff;
			}
			dst += stride;
		}
	}

	/** `Giz2Reader.Unpack`: the strips of eight places of the picture, one after another. */
	unpack(): Buffer {
		const strips = this.layout.width >> 3;
		const stride = this.layout.width >> 1;
		const output = Buffer.alloc(stride * this.layout.height);
		let dst = 0;
		for (let x = 0; x < strips; x += 1) {
			let mask = 1;
			for (let i = 0; i < PLACES_PER_RECORD; i += 1) {
				// The records of the places of a picture stand walked for every strip of the picture, and the
				// places of a record stand as the places of the strip before it stand them where the places of
				// the record stand unwalked for this strip.
				if ((this.layout.planeMap & mask) === 0) {
					const plane = this.planes[i];
					if (!plane)
						throw invalidPicture(
							"A record of the places of a picture stands nowhere",
						);
					this.unpackPlane(plane);
				}
				mask <<= 1;
			}
			this.copyPlanes(output, stride, dst);
			dst += PLACES_PER_RECORD;
		}
		return output;
	}
}

/** `Giz2Format.Read`: the places of a picture of this kind, walked into places of a picture of four places. */
export function unpackGiz2Picture(data: Buffer, layout: Giz2Layout): Buffer {
	return new Giz2Reader(data, layout).unpack();
}
