import { GarbroError } from "@garbro-mcp/core";

const LONGEST_WALK = 0x20;

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export class EdBitReader {
	private bits = 1;

	constructor(
		private readonly data: Buffer,
		private position = 0,
	) {}

	get at(): number {
		return this.position;
	}

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

	readBits(data: number, count: number): number {
		let value = data;
		for (let at = 0; at < count; at += 1) value = (value << 1) | this.nextBit();
		return value;
	}

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
