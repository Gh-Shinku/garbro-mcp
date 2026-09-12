// Format reference: GARbro ArcFormats/LzssStream.cs (LzssCoroutine and LzssReader).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// GARbro's default LZSS variant reads a control byte and treats set bits as literals, with a
// 12-bit ring buffer, a frame fill byte, and a configurable initial frame position. The Ail
// opener in ArcFormats/Ail/ArcAil.cs uses the same layout with an inverted control bit.

export interface LzssSettings {
	/** Ring buffer size; must be a power of two. GARbro default: 0x1000. */
	frameSize?: number;
	/** Byte used to pre-fill the ring buffer. GARbro default: 0. */
	frameFill?: number;
	/** Initial ring buffer write position. GARbro default: 0xfee. */
	frameInitPosition?: number;
	/**
	 * Control bit value that marks a literal. `1` matches GARbro's default LzssStream; `0` matches
	 * the reversed Ail variant.
	 */
	literalBit?: 0 | 1;
	/** Expected decompressed size. */
	outputLength: number;
}

interface ResolvedLzssSettings {
	frameSize: number;
	frameMask: number;
	frameFill: number;
	frameInitPosition: number;
	literalBit: 0 | 1;
	outputLength: number;
}

const DEFAULT_FRAME_SIZE = 0x1000;
const DEFAULT_FRAME_INIT_POSITION = 0xfee;
const MATCH_BASE_LENGTH = 3;

function resolveSettings(settings: LzssSettings): ResolvedLzssSettings {
	const frameSize = settings.frameSize ?? DEFAULT_FRAME_SIZE;
	const frameFill = settings.frameFill ?? 0;
	const frameInitPosition =
		settings.frameInitPosition ?? DEFAULT_FRAME_INIT_POSITION;
	const literalBit = settings.literalBit ?? 1;
	if (!Number.isSafeInteger(frameSize) || frameSize <= 0)
		throw new RangeError("LZSS frame size must be a positive integer");
	if ((frameSize & (frameSize - 1)) !== 0)
		throw new RangeError("LZSS frame size must be a power of two");
	if (!Number.isSafeInteger(frameFill) || frameFill < 0 || frameFill > 0xff)
		throw new RangeError("LZSS frame fill must be a byte value");
	if (!Number.isSafeInteger(settings.outputLength) || settings.outputLength < 0)
		throw new RangeError("LZSS output length must be a non-negative integer");
	return {
		frameSize,
		frameMask: frameSize - 1,
		frameFill,
		frameInitPosition: frameInitPosition & (frameSize - 1),
		literalBit,
		outputLength: settings.outputLength,
	};
}

export interface LzssStreamSettings {
	/** Ring buffer size; must be a power of two. GARbro default: 0x1000. */
	frameSize?: number;
	/** Byte used to pre-fill the ring buffer. GARbro default: 0. */
	frameFill?: number;
	/** Initial ring buffer write position. GARbro default: 0xfee. */
	frameInitPosition?: number;
	/**
	 * Control bit value that marks a literal. `1` matches GARbro's default LzssStream; `0` matches
	 * the reversed Ail variant.
	 */
	literalBit?: 0 | 1;
	/** Optional upper bound on the decoded size; decoding stops when it is reached. */
	maxOutputLength?: number;
}

interface ResolvedLzssStreamSettings {
	frameSize: number;
	frameMask: number;
	frameFill: number;
	frameInitPosition: number;
	literalBit: 0 | 1;
	maxOutputLength: number;
}

const DEFAULT_OUTPUT_LIMIT = 0x40000000; // 1 GiB guard against runaway streams.

function resolveStreamSettings(
	settings: LzssStreamSettings,
): ResolvedLzssStreamSettings {
	const frameSize = settings.frameSize ?? DEFAULT_FRAME_SIZE;
	const frameFill = settings.frameFill ?? 0;
	const frameInitPosition =
		settings.frameInitPosition ?? DEFAULT_FRAME_INIT_POSITION;
	const literalBit = settings.literalBit ?? 1;
	const maxOutputLength = settings.maxOutputLength ?? DEFAULT_OUTPUT_LIMIT;
	if (!Number.isSafeInteger(frameSize) || frameSize <= 0)
		throw new RangeError("LZSS frame size must be a positive integer");
	if ((frameSize & (frameSize - 1)) !== 0)
		throw new RangeError("LZSS frame size must be a power of two");
	if (!Number.isSafeInteger(frameFill) || frameFill < 0 || frameFill > 0xff)
		throw new RangeError("LZSS frame fill must be a byte value");
	if (!Number.isSafeInteger(maxOutputLength) || maxOutputLength < 0)
		throw new RangeError("LZSS output limit must be a non-negative integer");
	return {
		frameSize,
		frameMask: frameSize - 1,
		frameFill,
		frameInitPosition: frameInitPosition & (frameSize - 1),
		literalBit,
		maxOutputLength,
	};
}

/**
 * Decompresses a GARbro LZSS stream that has no declared output size, decoding until the input is
 * exhausted. GARbro's `LzssStream` behaves the same way when reading to EOF.
 */
export function inflateLzssAll(
	input: Uint8Array,
	settings: LzssStreamSettings = {},
): Buffer {
	const resolved = resolveStreamSettings(settings);
	const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	const chunks: Buffer[] = [];
	let pending = Buffer.alloc(64 * 1024);
	let pendingLength = 0;
	const frame = Buffer.alloc(resolved.frameSize, resolved.frameFill);
	let framePosition = resolved.frameInitPosition;
	let sourcePosition = 0;
	let outputLength = 0;

	const push = (value: number): void => {
		if (outputLength >= resolved.maxOutputLength)
			throw new RangeError("LZSS output exceeds the configured limit");
		if (pendingLength === pending.length) {
			chunks.push(pending);
			pending = Buffer.alloc(64 * 1024);
			pendingLength = 0;
		}
		pending[pendingLength++] = value;
		outputLength += 1;
	};

	const literalMarker = resolved.literalBit === 1 ? 1 : 0;
	while (sourcePosition < source.length) {
		const control = source[sourcePosition++] ?? 0;
		for (let bit = 0; bit < 8; bit += 1) {
			const isLiteral = ((control >> bit) & 1) === literalMarker;
			if (isLiteral) {
				if (sourcePosition >= source.length) break;
				const value = source[sourcePosition++] ?? 0;
				frame[framePosition++ & resolved.frameMask] = value;
				push(value);
			} else {
				if (sourcePosition + 2 > source.length) {
					sourcePosition = source.length;
					break;
				}
				const low = source[sourcePosition++] ?? 0;
				const high = source[sourcePosition++] ?? 0;
				let offset = ((high & 0xf0) << 4) | low;
				let count = MATCH_BASE_LENGTH + (high & 0x0f);
				while (count > 0) {
					const value = frame[offset++ & resolved.frameMask] ?? 0;
					frame[framePosition++ & resolved.frameMask] = value;
					push(value);
					count -= 1;
				}
			}
		}
	}
	chunks.push(pending.subarray(0, pendingLength));
	return Buffer.concat(chunks);
}

/**
 * Decompresses one GARbro LZSS stream into a buffer.
 *
 * GARbro stops quietly when the input ends before the declared output length, so this port keeps
 * the same tolerance and returns the bytes decoded so far.
 */
export function inflateLzss(input: Uint8Array, settings: LzssSettings): Buffer {
	const resolved = resolveSettings(settings);
	const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	const output = Buffer.alloc(resolved.outputLength);
	const frame = Buffer.alloc(resolved.frameSize, resolved.frameFill);
	let framePosition = resolved.frameInitPosition;
	let sourcePosition = 0;
	let outputPosition = 0;

	const literalMarker = resolved.literalBit === 1 ? 1 : 0;
	while (outputPosition < output.length) {
		if (sourcePosition >= source.length) break;
		const control = source[sourcePosition++] ?? 0;
		for (let bit = 0; bit < 8 && outputPosition < output.length; bit += 1) {
			const isLiteral = ((control >> bit) & 1) === literalMarker;
			if (isLiteral) {
				if (sourcePosition >= source.length)
					return output.subarray(0, outputPosition);
				const value = source[sourcePosition++] ?? 0;
				frame[framePosition++ & resolved.frameMask] = value;
				output[outputPosition++] = value;
			} else {
				if (sourcePosition + 2 > source.length)
					return output.subarray(0, outputPosition);
				const low = source[sourcePosition++] ?? 0;
				const high = source[sourcePosition++] ?? 0;
				let offset = ((high & 0xf0) << 4) | low;
				let count = MATCH_BASE_LENGTH + (high & 0x0f);
				while (count > 0 && outputPosition < output.length) {
					const value = frame[offset++ & resolved.frameMask] ?? 0;
					frame[framePosition++ & resolved.frameMask] = value;
					output[outputPosition++] = value;
					count -= 1;
				}
			}
		}
	}
	return output.subarray(0, outputPosition);
}
