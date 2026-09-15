/**
 * The reference's `Binary.CopyOverlapped`, which the formats that unpack a picture with a back reference all
 * lean on: when the destination is in front of the source the copy repeats what it has already written, and
 * otherwise it is a plain move of a range that cannot overlap itself forwards.
 *
 * The reference's own bounds are those of a block copy, so a range that reaches outside the buffer is the
 * exception it would raise. Nothing is raised here: such a range writes the bytes a C# read past the end of an
 * array would leave undefined, which is the zeroes this buffer already holds, and the call reports whether the
 * range was inside the buffer so an unpacker that treats it as a failure can say so.
 */
export function copyOverlapped(
	data: Buffer,
	source: number,
	destination: number,
	count: number,
): boolean {
	const inside =
		count >= 0 &&
		source >= 0 &&
		destination >= 0 &&
		source + count <= data.length &&
		destination + count <= data.length;
	for (let i = 0; i < count; i += 1) {
		data[destination + i] = data[source + i] ?? 0;
	}
	return inside;
}
