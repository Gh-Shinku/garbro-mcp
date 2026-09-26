// Format reference: GARbro "ArcFormats/Unity/Texture2D.cs", classes `Texture2D` and `Texture2DDecoder`,
// which the walk of the objects of an asset of the engine of the reference hands the objects of the kind
// `Texture2D` to.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	writeBmp16,
	writeBmp24,
	writeBmp32,
	writeBmp8,
} from "../shared/bmp.js";
import { unpackDxt1, unpackDxt5 } from "../shared/dxt.js";
import { RGB565_MASKS } from "../shared/bmp.js";
import type { UnityReader } from "./asset-file.js";

/** The kinds of picture the engine keeps, of the counts the reference counts them by. */
export const TEXTURE_ALPHA8 = 1;
export const TEXTURE_ARGB4444 = 2;
export const TEXTURE_RGB24 = 3;
export const TEXTURE_RGBA32 = 4;
export const TEXTURE_ARGB32 = 5;
export const TEXTURE_R16 = 6;
export const TEXTURE_RGB565 = 7;
export const TEXTURE_DXT1 = 10;
export const TEXTURE_DXT5 = 12;
export const TEXTURE_RGBA4444 = 13;
export const TEXTURE_BGRA32 = 14;
export const TEXTURE_BC7 = 25;
export const TEXTURE_DXT1_CRUNCHED = 28;
export const TEXTURE_DXT5_CRUNCHED = 29;
/** The kinds of picture the walk of this port reads; of the kinds it does not, `decodeUnityTexture2d` stands. */
const READ_FORMATS = new Set([
	TEXTURE_ALPHA8,
	TEXTURE_ARGB4444,
	TEXTURE_RGB24,
	TEXTURE_RGBA32,
	TEXTURE_ARGB32,
	TEXTURE_R16,
	TEXTURE_RGB565,
	TEXTURE_DXT1,
	TEXTURE_DXT5,
	TEXTURE_BGRA32,
]);

/** The head of a picture of an object of the engine, and the places of the picture behind it. */
export interface UnityTexture2d {
	width: number;
	height: number;
	format: number;
	data: Buffer;
}

/** The versions of the kinds of the walk whose places stand of a shape of their own. */
const VERSIONS_2017 = new Set(["2017.3.1f1", "2019.3.0f1", "2017.4.3f1"]);
const VERSION_2021 = "2021.1.3f1";
const VERSION_2019 = "2019.3.0f1";

/**
 * `Texture2D.Load`, `Texture2D.Load2021` and the walk the reference stands of three versions of the kind of
 * the picture: the name, the measurements, the kind of the places of the picture, the counts of its own, and
 * the count of the places of the picture, which stand behind the head.
 */
export function readUnityTexture2d(
	reader: UnityReader,
	version: string | undefined,
	format: number,
): UnityTexture2d | undefined {
	if (undefined === version) return undefined;
	if (VERSION_2021 === version) return readUnityTexture2d2021(reader);
	if (VERSIONS_2017.has(version)) {
		return readUnityTexture2dVersion(reader, version);
	}
	return readUnityTexture2dPlain(reader, format, version);
}

function readUnityTexture2dPlain(
	reader: UnityReader,
	format: number,
	version: string,
): UnityTexture2d {
	reader.readString();
	reader.align();
	const width = reader.readInt32();
	const height = reader.readInt32();
	reader.readInt32(); // m_CompleteImageSize
	const textureFormat = reader.readInt32();
	reader.readInt32(); // m_MipCount
	if (format > 9) {
		reader.readBool(); // m_IsReadable
		reader.readBool(); // m_ReadAllowed
		reader.align();
	}
	reader.readInt32(); // m_ImageCount
	reader.readInt32(); // m_TextureDimension
	reader.readInt32(); // m_FilterMode
	reader.readInt32(); // m_Aniso
	reader.readBytes(4); // m_MipBias, of four places of the file
	reader.readInt32(); // m_WrapMode
	reader.readInt32(); // m_LightmapFormat
	reader.readInt32(); // m_ColorSpace
	const dataLength = reader.readInt32();
	if (0 === dataLength && version.startsWith("2017.")) reader.readBytes(8);
	return texture(reader, width, height, textureFormat, dataLength);
}

function readUnityTexture2dVersion(
	reader: UnityReader,
	version: string,
): UnityTexture2d {
	reader.readString();
	reader.align();
	reader.readInt32(); // m_ForcedFallbackFormat
	reader.readInt32(); // m_DownscaleFallback
	const width = reader.readInt32();
	const height = reader.readInt32();
	reader.readInt32(); // m_CompleteImageSize
	const textureFormat = reader.readInt32();
	reader.readInt32(); // m_MipCount
	reader.readBool(); // m_IsReadable
	reader.align();
	if (VERSION_2019 === version) reader.readInt32(); // m_StreamingMipmapsPriority
	reader.readInt32(); // m_ImageCount
	reader.readInt32(); // m_TextureDimension
	reader.readInt32(); // m_FilterMode
	reader.readInt32(); // m_Aniso
	reader.readBytes(4); // m_MipBias
	reader.readInt32(); // m_WrapMode
	reader.readInt32(); // m_LightmapFormat
	reader.readInt32(); // m_ColorSpace
	const dataLength = reader.readInt32();
	return texture(reader, width, height, textureFormat, dataLength);
}

function readUnityTexture2d2021(reader: UnityReader): UnityTexture2d {
	reader.readString();
	reader.align();
	reader.readInt32(); // m_ForcedFallbackFormat
	reader.readInt32(); // m_DownscaleFallback
	const width = reader.readInt32();
	const height = reader.readInt32();
	reader.readInt32(); // m_CompleteImageSize
	reader.readInt32(); // m_MipsStripped
	const textureFormat = reader.readInt32();
	reader.readInt32(); // m_MipCount
	reader.readBool(); // m_IsReadable
	reader.align();
	reader.readInt32(); // m_StreamingMipmapsPriority
	reader.readInt32(); // m_ImageCount
	reader.readInt32(); // m_TextureDimension
	reader.readInt32(); // m_FilterMode
	reader.readInt32(); // m_Aniso
	reader.readBytes(4); // m_MipBias
	reader.readInt32(); // m_WrapMode
	reader.readInt32(); // m_LightmapFormat
	reader.readInt32(); // m_ColorSpace
	reader.readInt32(); // m_MipsStripped
	const dataLength = reader.readInt32();
	return texture(reader, width, height, textureFormat, dataLength);
}

/** The places of the picture behind the head, which `Texture2D.LoadData` reads where the picture is asked. */
function texture(
	reader: UnityReader,
	width: number,
	height: number,
	format: number,
	dataLength: number,
): UnityTexture2d {
	const data = dataLength > 0 ? reader.readBytes(dataLength) : Buffer.alloc(0);
	return { width, height, format, data };
}

/**
 * `Texture2DDecoder.Unpack`: the places of the picture, of the kind the head of it names. The places stand of
 * the rows of the picture from its foot up, which the reference stands of `CreateFlipped`; this port hands out
 * a bitmap the right way up.
 */
export function decodeUnityTexture2d(
	texturePicture: UnityTexture2d,
): Buffer | undefined {
	const { width, height, format, data } = texturePicture;
	if (0 === width || 0 === height) return undefined;
	switch (format) {
		case TEXTURE_ALPHA8: {
			const pixels = flipRows(data, width, width, height);
			return writeBmp8(width, height, pixels);
		}
		case TEXTURE_R16: {
			// The reference hands out a picture of one place of grey of sixteen places; a bitmap of this
			// project stands of one place of grey of eight, so the low places of the file stand dropped.
			const pixels: Buffer = Buffer.alloc(width * height, 0x00);
			for (let at = 0; at * 2 + 1 < data.length; at += 1) {
				pixels[at] = data.readUInt16LE(at * 2) >> 8;
			}
			const places = flipRows(pixels, width, width, height);
			return writeBmp8(width, height, places);
		}
		case TEXTURE_RGB24: {
			// The places of the picture stand red, green then blue, while a bitmap of this project stands
			// them blue, green then red.
			const swapped = Buffer.from(data);
			for (let at = 0; at + 2 < swapped.length; at += 3) {
				const red = swapped[at] ?? 0;
				swapped[at] = swapped[at + 2] ?? 0;
				swapped[at + 2] = red;
			}
			return writeBmp24(
				width,
				height,
				flipRows(swapped, width * 3, width * 3, height),
			);
		}
		case TEXTURE_BGRA32:
			return writeBmp32(
				width,
				height,
				flipRows(data, width * 4, width * 4, height),
			);
		case TEXTURE_RGBA32: {
			const pixels = Buffer.from(data);
			for (let at = 0; at + 3 < pixels.length; at += 4) {
				const red = pixels[at] ?? 0;
				pixels[at] = pixels[at + 2] ?? 0;
				pixels[at + 2] = red;
			}
			return writeBmp32(
				width,
				height,
				flipRows(pixels, width * 4, width * 4, height),
			);
		}
		case TEXTURE_ARGB32: {
			// `ConvertArgb`: every place of four of the file stands the other way round, which is what the
			// reference reads the long way round and stands the short way round.
			const pixels = Buffer.from(data);
			pixels.swap32();
			return writeBmp32(
				width,
				height,
				flipRows(pixels, width * 4, width * 4, height),
			);
		}
		case TEXTURE_ARGB4444: {
			const pixels: Buffer = Buffer.alloc(width * height * 4, 0x00);
			for (let at = 0; at * 2 + 1 < data.length; at += 1) {
				const value = data.readUInt16LE(at * 2);
				pixels[at * 4] = (value & 0x0f) * 0x11;
				pixels[at * 4 + 1] = ((value >> 4) & 0x0f) * 0x11;
				pixels[at * 4 + 2] = ((value >> 8) & 0x0f) * 0x11;
				pixels[at * 4 + 3] = ((value >> 12) & 0x0f) * 0x11;
			}
			return writeBmp32(
				width,
				height,
				flipRows(pixels, width * 4, width * 4, height),
			);
		}
		case TEXTURE_RGB565: {
			const stride = (width * 2 + 3) & ~3;
			const pixels = flipRows(data, stride, width * 2, height);
			return writeBmp16(width, height, pixels, false, RGB565_MASKS);
		}
		case TEXTURE_DXT1:
			return writeBmp32(
				width,
				height,
				flipRows(unpackDxt1(data, width, height), width * 4, width * 4, height),
			);
		case TEXTURE_DXT5:
			return writeBmp32(
				width,
				height,
				flipRows(unpackDxt5(data, width, height), width * 4, width * 4, height),
			);
		default:
			return undefined;
	}
}

/** Whether the kind of picture the head names is one the walk of this port reads. */
export function isUnityTextureFormat(format: number): boolean {
	return READ_FORMATS.has(format);
}

/** The rows of the picture the other way round, of the rows the file stores them in. */
function flipRows(
	data: Buffer,
	rowBytes: number,
	width: number,
	height: number,
): Buffer {
	const output: Buffer = Buffer.alloc(rowBytes * height, 0x00);
	for (let row = 0; row < height; row += 1) {
		data.copy(
			output,
			row * rowBytes,
			(height - 1 - row) * rowBytes,
			(height - row) * rowBytes,
		);
	}
	if (rowBytes === width) return output;
	const packed: Buffer = Buffer.alloc(width * height, 0x00);
	for (let row = 0; row < height; row += 1) {
		output.copy(packed, row * width, row * rowBytes, row * rowBytes + width);
	}
	return packed;
}
