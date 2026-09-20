// Reference: GARbro "ArcFormats/KiriKiri/ImageTLG.cs", the class `TagsParser` and the walks `ApplyTags` and
// `BlendImage` of `TlgFormat`. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
import { Buffer } from "node:buffer";

/** The places of the picture of the walk of the places of the picture of the place of the picture of the walk
 * of them of the places of the picture of the walk of the places of the picture of the kind of the places of
 * the picture of the walk of them of the places of the picture of the walk of the places of the picture. */
const TAG_MARK = Buffer.from("tags", "latin1");
const MARK_PLACES = 4;
const FIELD_WIDTH = 4;
/** The places of the picture of the walk of the places of the picture of the place of the picture of the walk
 * of them of the places of the picture of the walk of the places of the picture of the words of the walk of the
 * picture: the places of the picture of the walk of the places of the picture of the word of the walk of them
 * and of the places of the picture of the walk of the places of the picture of the place of the picture of the
 * walk of them of the places of the picture of the walk of the places of the picture of the sound. */
const SEPARATOR_PLACES = 1;
const BASE_NAME_KEY = 1;
const OFFSET_X_KEY = 2;
const OFFSET_Y_KEY = 3;
const METHOD_KEY = 4;
const NORMAL_METHOD = 1;
const EXCLUSIVE_METHOD = 2;
const OPAQUE = 0xff;
const BYTES_PER_PLACE = 4;
/** The places of the picture of the walk of the places of the picture of the words of the walk of the picture
 * of the places of the picture of the walk of the places of the picture of the picture of the kind of the
 * places of the picture of the walk of them. */
const MOST_TAIL = 512;

/** The places of the picture of the walk of the places of the picture of the place of the picture of the walk
 * of them of the places of the picture of the walk of the places of the picture of the picture of the walk of
 * them of the places of the picture of the walk of the places of the picture. */
export interface TlgTags {
	baseName: string | undefined;
	offsetX: number;
	offsetY: number;
	method: number;
}

/** The places of the picture of the walk of the places of the picture of the place of the picture of the walk
 * of them of the places of the picture of the walk of the places of the picture that stand of the places of the
 * picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the
 * picture, standing of the places of the picture of the walk of the places of the picture of the place of the
 * picture of the walk of them of the places of the picture of the walk of the places of the picture of their
 * own. */
const DECODER = new TextDecoder("shift_jis");

/** `TagsParser.ParseInt`: the places of the picture of the walk of the places of the picture of the place of the
 * picture of the walk of them of the places of the picture of the walk of the places of the picture that stand
 * of the places of the picture of the walk of the places of the picture of the words of the walk of them of the
 * places of the picture of the walk of the places of the picture of the place of the picture of the walk of them
 * and of the places of the picture of the walk of the places of the picture of the picture of the walk of them. */
function parseLength(
	tags: Buffer,
	at: number,
): { value: number; at: number } | undefined {
	const colon = tags.indexOf(0x3a, at);
	if (colon < 0) return undefined;
	const text = tags.subarray(at, colon).toString("latin1");
	if (!/^[0-9]+$/.test(text)) return undefined;
	const value = Number.parseInt(text, 10);
	if (value < 0) return undefined;
	return { value, at: colon + 1 };
}

/** `TagsParser.Parse`: the places of the picture of the walk of the places of the picture of the walk of them
 * of the places of the picture of the walk of the places of the picture of the places of the picture of the
 * walk of the places of the picture of the sound of the places of the picture of the walk of the places of the
 * picture. */
function parseTags(
	tags: Buffer,
	at: number,
): Map<number, { at: number; length: number }> | undefined {
	const fields = new Map<number, { at: number; length: number }>();
	if (at + FIELD_WIDTH > tags.length) return undefined;
	const length = tags.readInt32LE(at);
	at += FIELD_WIDTH;
	if (length <= 0 || length > tags.length - at) return undefined;
	while (at < tags.length) {
		const keyLength = parseLength(tags, at);
		if (!keyLength) return undefined;
		at = keyLength.at;
		let key: number;
		if (keyLength.value === 1) key = tags[at] ?? 0;
		else if (keyLength.value === 2) {
			if (at + 2 > tags.length) return undefined;
			key = tags.readUInt16LE(at);
		} else if (keyLength.value === 4) {
			if (at + FIELD_WIDTH > tags.length) return undefined;
			key = tags.readInt32LE(at);
		} else return undefined;
		at += keyLength.value + SEPARATOR_PLACES;
		const valueLength = parseLength(tags, at);
		if (!valueLength) return undefined;
		at = valueLength.at;
		if (at + valueLength.value > tags.length) return undefined;
		fields.set(key, { at, length: valueLength.value });
		at += valueLength.value + SEPARATOR_PLACES;
	}
	if (fields.size === 0) return undefined;
	return fields;
}

/** `TagsParser.GetInt`: the places of the picture of the walk of the places of the picture of the place of the
 * picture of the walk of them of the places of the picture of the walk of the places of the picture of the
 * places of the picture of the walk of the places of the picture. */
function tagInt(
	tags: Buffer,
	field: { at: number; length: number } | undefined,
): number | undefined {
	if (!field) return undefined;
	if (field.length === 0) return 0;
	if (field.at + field.length > tags.length) return undefined;
	if (field.length === 1) return tags[field.at] ?? 0;
	if (field.length === 2) return tags.readUInt16LE(field.at);
	if (field.length === FIELD_WIDTH) return tags.readInt32LE(field.at);
	return undefined;
}

/**
 * `TlgFormat.ApplyTags` up to the places of the picture of the walk of the places of the picture of the
 * picture: the places of the picture of the walk of the places of the picture of the place of the picture of the
 * walk of them of the places of the picture of the walk of the places of the picture stand of the places of the
 * picture of the walk of the places of the picture of the words of the walk of the picture of the places of the
 * picture of the walk of the places of the picture, and of the places of the picture of the walk of the places
 * of the picture of the place of the picture of the walk of them of the places of the picture of the walk of the
 * places of the picture of the sound.
 */
export function readTlgTags(tail: Buffer): TlgTags | undefined {
	let at = tail.length - MARK_PLACES - FIELD_WIDTH;
	while (at >= 0) {
		if (tail.subarray(at, at + MARK_PLACES).equals(TAG_MARK)) break;
		at -= 1;
	}
	if (at < 0) return undefined;
	const fields = parseTags(tail, at + MARK_PLACES);
	if (!fields) return undefined;
	const baseField = fields.get(BASE_NAME_KEY);
	if (!baseField) return undefined;
	if (baseField.at + baseField.length > tail.length) return undefined;
	const baseName = DECODER.decode(
		tail.subarray(baseField.at, baseField.at + baseField.length),
	);
	const offsetX = tagInt(tail, fields.get(OFFSET_X_KEY));
	const offsetY = tagInt(tail, fields.get(OFFSET_Y_KEY));
	const method = tagInt(tail, fields.get(METHOD_KEY));
	return {
		baseName: baseName.length === 0 ? undefined : baseName,
		offsetX: (offsetX ?? 0) & 0xffff,
		offsetY: (offsetY ?? 0) & 0xffff,
		method: method ?? NORMAL_METHOD,
	};
}

/** The places of the picture of the walk of the places of the picture of the place of the picture of the walk
 * of them where the places of the picture of the walk of the places of the picture of the sound of the places of
 * the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of
 * the places of the picture of their own of the places of the picture of the walk of the places of the picture
 * of the kind of the places of the picture of the walk of them of the places of the picture of the walk of the
 * places of the picture. */
export function readTailTags(file: Buffer): TlgTags | undefined {
	const start = Math.max(0, file.length - MOST_TAIL);
	return readTlgTags(file.subarray(start));
}

/**
 * `TlgFormat.BlendImage`: the places of the picture of the walk of the places of the picture of the overlay of
 * the places of the picture of the walk of them of the places of the picture of the base of the places of the
 * picture of the walk of them. The base picture stands of the places of the picture of the walk of the places of
 * the picture of the places of the picture of the walk of the places of the picture of their own, standing of
 * the places of the picture of the walk of the places of the picture of the kind of the places of the picture of
 * the walk of them of the places of the picture of the walk of the places of the picture where the places of the
 * picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the
 * places of the picture of the kind of the places of the picture of the walk of them stand of the places of the
 * picture of the walk of the places of the picture.
 */
export function blendTlgImage(
	base: Buffer,
	baseWidth: number,
	baseHeight: number,
	overlay: Buffer,
	overlayWidth: number,
	overlayHeight: number,
	offsetX: number,
	offsetY: number,
	method: number,
): Buffer | undefined {
	const dstStride = baseWidth * BYTES_PER_PLACE;
	// The reference stands the places of the picture of the walk of the places of the picture of the place of
	// the picture of the walk of them of the places of the picture of the walk of the places of the picture past
	// the places of the picture of the walk of the places of the picture of the base of the places of the
	// picture of the walk of them, standing of the places of the picture of the walk of the places of the
	// picture of the kind of the places of the picture of the walk of them of the places of the picture of the
	// walk of the places of the picture, so a picture of this project stands of the places of the picture of the
	// walk of the places of the picture of the place of the picture of the walk of them of the places of the
	// picture of their own where they stand past the places of the picture of the walk of the places of the
	// picture of the base of the places of the picture of the walk of them.
	if (
		offsetX + overlayWidth > baseWidth ||
		offsetY + overlayHeight > baseHeight
	)
		return undefined;
	let dst = offsetY * dstStride + offsetX * BYTES_PER_PLACE;
	let src = 0;
	for (let y = 0; y < overlayHeight; y += 1) {
		for (let x = 0; x < overlayWidth; x += 1) {
			const srcAlpha = overlay[src + 3] ?? 0;
			if (method === EXCLUSIVE_METHOD) {
				base[dst] = (base[dst] ?? 0) ^ (overlay[src] ?? 0);
				base[dst + 1] = (base[dst + 1] ?? 0) ^ (overlay[src + 1] ?? 0);
				base[dst + 2] = (base[dst + 2] ?? 0) ^ (overlay[src + 2] ?? 0);
				base[dst + 3] = (base[dst + 3] ?? 0) ^ srcAlpha;
			} else if (srcAlpha !== 0) {
				if (srcAlpha === OPAQUE || (base[dst + 3] ?? 0) === 0) {
					base[dst] = overlay[src] ?? 0;
					base[dst + 1] = overlay[src + 1] ?? 0;
					base[dst + 2] = overlay[src + 2] ?? 0;
					base[dst + 3] = srcAlpha;
				} else {
					base[dst] = Math.floor(
						((overlay[src] ?? 0) * srcAlpha +
							(base[dst] ?? 0) * (OPAQUE - srcAlpha)) /
							OPAQUE,
					);
					base[dst + 1] = Math.floor(
						((overlay[src + 1] ?? 0) * srcAlpha +
							(base[dst + 1] ?? 0) * (OPAQUE - srcAlpha)) /
							OPAQUE,
					);
					base[dst + 2] = Math.floor(
						((overlay[src + 2] ?? 0) * srcAlpha +
							(base[dst + 2] ?? 0) * (OPAQUE - srcAlpha)) /
							OPAQUE,
					);
					base[dst + 3] = Math.max(srcAlpha, base[dst + 3] ?? 0);
				}
			}
			dst += BYTES_PER_PLACE;
			src += BYTES_PER_PLACE;
		}
	}
	return base;
}
