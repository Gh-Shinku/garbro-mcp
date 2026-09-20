// Format reference: GARbro "ArcFormats/ActiveSoft/ImageEDT.cs", class `BitReader` (the walk of the places of a
// picture of the two kinds of the pictures of the engine: the places of the walk of a picture stand in the
// places of every place of the picture of the walk of it, the first place of the walk of a picture standing in
// the place behind the first place of the picture of the walk of it). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";

/** The places of the walk of a picture of a kind stand for the places of the walk of a picture of the count of
 * them, of the places of the walk of the count of its own. */
const LONGEST_WALK = 0x20;

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `BitReader`: the places of the walk of a picture of the engine. */
export class EdBitReader {
	private bits = 1;

	constructor(
		private readonly data: Buffer,
		private position = 0,
	) {}

	/** Where the places of the walk of the picture stand in the places of the picture of the walk of them. */
	get at(): number {
		return this.position;
	}

	/** `BitReader.NextBit`: the place of the walk of a picture behind the places of the walk of it read of it,
	 * the places of the walk of a picture standing in the places of the picture of every place of the walk of
	 * the picture of the walk of them. */
	nextBit(): number {
		if (this.bits === 1) {
			if (this.position >= this.data.length)
				throw invalidPicture(
					"The places of the walk of a picture stand short of the places of the picture they walk",
				);
			this.bits = (this.data[this.position] ?? 0) | 0x100;
			this.position += 1;
		}
		const bit = this.bits & 1;
		this.bits >>= 1;
		return bit;
	}

	/** `BitReader.ReadBits`: the places of the walk of a picture of the count of them, the first place of the
	 * walk of the picture standing above the places of the walk of the count. */
	readBits(data: number, count: number): number {
		let value = data;
		for (let at = 0; at < count; at += 1) value = (value << 1) | this.nextBit();
		return value;
	}

	/** `BitReader.CountBits`: the count of the places of the walk of a picture of the kind of the count of
	 * them: the places of the walk of the count of a picture stand as the places of the walk of a picture of
	 * its own, the first place of the walk of the count standing for the places of the walk of the picture of
	 * the count of them. */
	countBits(): number {
		let bit = 1;
		let count = 0;
		while (count < LONGEST_WALK && bit === 1) {
			count += 1;
			bit = this.nextBit();
		}
		count -= 1;
		if (count !== 0) return this.readBits(1, count);
		return 1;
	}
}
