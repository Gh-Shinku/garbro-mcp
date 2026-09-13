// GARBro ArcFormats/RiddleSoft/ImageGCP.cs, CmpReader.
export function inflateRiddleCmp(
	input: Uint8Array,
	outputLength: number,
): Buffer {
	if (!Number.isSafeInteger(outputLength) || outputLength < 0)
		throw new RangeError("output length must be non-negative");
	const output = Buffer.alloc(outputLength);
	const frame = Buffer.alloc(0x800);
	frame.fill(0x20, 0, 0x7ef);
	let framePos = 0x7ef,
		dst = 0,
		src = 0,
		bits = 0,
		available = 0;
	const get = (count: number): number | undefined => {
		while (available < count) {
			if (src >= input.length) return undefined;
			bits = (bits << 8) | (input[src++] ?? 0);
			available += 8;
		}
		available -= count;
		return (bits >> available) & ((1 << count) - 1);
	};
	while (dst < output.length) {
		const flag = get(1);
		if (flag === undefined) break;
		if (flag) {
			const value = get(8);
			if (value === undefined) break;
			output[dst++] = value;
			frame[framePos++ & 0x7ff] = value;
		} else {
			const offset = get(11),
				length = get(4);
			if (offset === undefined || length === undefined) break;
			for (let i = 0; i < length + 2 && dst < output.length; i++) {
				const value = frame[(offset + i) & 0x7ff] ?? 0;
				output[dst++] = value;
				frame[framePos++ & 0x7ff] = value;
			}
		}
	}
	return output;
}
