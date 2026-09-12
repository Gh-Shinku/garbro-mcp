// Format reference: GARbro Legacy/Aaru/ArcFL4.cs (RleDecompressor).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

const LITERAL_BLOCK = 0x100;

/**
 * Decodes the Aaru RLE stream used by `RD1.0` entries. The chunk count comes from the entry
 * header; decoding stops early when the input ends.
 */
export function inflateAaruRle(input: Uint8Array, chunks: number): Buffer {
	const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	const parts: Buffer[] = [];
	let pending = Buffer.alloc(64 * 1024);
	let pendingLength = 0;
	const push = (value: number): void => {
		if (pendingLength === pending.length) {
			parts.push(pending);
			pending = Buffer.alloc(64 * 1024);
			pendingLength = 0;
		}
		pending[pendingLength++] = value;
	};
	let position = 0;
	for (let chunk = 0; chunk < chunks; chunk += 1) {
		if (position >= source.length) break;
		const control = source[position++] ?? 0;
		if (control <= 1) {
			let count = control === 0 ? (source[position++] ?? 0) : LITERAL_BLOCK;
			while (count > 0) {
				if (position >= source.length) {
					parts.push(pending.subarray(0, pendingLength));
					return Buffer.concat(parts);
				}
				push(source[position++] ?? 0);
				count -= 1;
			}
		} else {
			let count: number;
			if (control === 3) {
				if (position + 2 > source.length) break;
				count = source.readUInt16LE(position);
				position += 2;
			} else {
				count = control;
			}
			const value = source[position++] ?? 0;
			while (count > 0) {
				push(value);
				count -= 1;
			}
		}
	}
	parts.push(pending.subarray(0, pendingLength));
	return Buffer.concat(parts);
}
