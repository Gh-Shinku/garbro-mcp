import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

const RIFF_MARK = Buffer.from("RIFF", "latin1");
const WEBP_MARK = Buffer.from("WEBP", "latin1");
const HEAD_SIZE = 12;
const CHUNK_HEAD_SIZE = 8;
const VP8X_MARK = Buffer.from("VP8X", "latin1");
const VP8_MARK = Buffer.from("VP8 ", "latin1");
const VP8L_MARK = Buffer.from("VP8L", "latin1");
const ALPH_MARK = Buffer.from("ALPH", "latin1");
const LEAST_VP8X = 10;
const LEAST_WALK = 10;
const LOSSLESS_HEAD = 0x2f;
const LOSSY_HEAD = [0x9d, 0x01, 0x2a];
const LOCATED_PLACES = 0x3fff;
const ALPHA_BIT = 0x10;
const PLACES_OF_THE_PICTURE = 2 ** 32;

export interface WebpLayout {
	flags: number;
	isLossless: boolean;
	hasAlpha: boolean;
	width: number;
	height: number;
	dataOffset: number;
	dataSize: number;
	alphaOffset: number;
	alphaSize: number;
}

function readInt24(data: Buffer, at: number): number {
	return (
		((data[at] ?? 0) |
			((data[at + 1] ?? 0) << 8) |
			((data[at + 2] ?? 0) << 16)) &
		0xffffff
	);
}

function readSigned24AsUint(data: Buffer, at: number): number {
	return ((readInt24(data, at) << 8) >> 8) >>> 0;
}

export function readWebpLayout(
	data: Buffer,
	fileLength = data.length,
): WebpLayout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, RIFF_MARK.length).equals(RIFF_MARK)) return undefined;
	if (!data.subarray(8, 8 + WEBP_MARK.length).equals(WEBP_MARK))
		return undefined;
	const layout: WebpLayout = {
		flags: 0,
		isLossless: false,
		hasAlpha: false,
		width: 0,
		height: 0,
		dataOffset: 0,
		dataSize: 0,
		alphaOffset: 0,
		alphaSize: 0,
	};
	let foundFeatures = false;
	let at = HEAD_SIZE;
	for (;;) {
		if (at + CHUNK_HEAD_SIZE > data.length) return undefined;
		const chunkSize = data.readInt32LE(at + 4);
		const alignedSize = (chunkSize + 1) & ~1;
		const mark = data.subarray(at, at + 4);
		if (!foundFeatures && mark.equals(VP8X_MARK)) {
			foundFeatures = true;
			if (chunkSize < LEAST_VP8X) return undefined;
			if (at + CHUNK_HEAD_SIZE + chunkSize > data.length) return undefined;
			const body = data.subarray(at + CHUNK_HEAD_SIZE);
			layout.flags = body.readUInt32LE(0);
			layout.width = 1 + readSigned24AsUint(body, 4);
			layout.height = 1 + readSigned24AsUint(body, 7);
			if (layout.width * layout.height >= PLACES_OF_THE_PICTURE)
				return undefined;
			at += CHUNK_HEAD_SIZE + chunkSize;
			continue;
		}
		if (mark.equals(VP8_MARK) || mark.equals(VP8L_MARK)) {
			layout.isLossless = (mark[3] ?? 0) === 0x4c;
			layout.dataOffset = at + CHUNK_HEAD_SIZE;
			layout.dataSize = alignedSize;
			if (!foundFeatures) {
				if (chunkSize < LEAST_WALK) return undefined;
				if (at + CHUNK_HEAD_SIZE + LEAST_WALK > data.length) return undefined;
				const head = data.subarray(at + CHUNK_HEAD_SIZE);
				if (layout.isLossless) {
					if ((head[0] ?? 0) !== LOSSLESS_HEAD) return undefined;
					if ((head[4] ?? 0) >> 5 !== 0) return undefined;
					const places = head.readUInt32LE(1);
					layout.width = (places & LOCATED_PLACES) + 1;
					layout.height = ((places >>> 14) & LOCATED_PLACES) + 1;
					layout.hasAlpha = ((head[4] ?? 0) & ALPHA_BIT) !== 0;
				} else {
					for (const [index, place] of LOSSY_HEAD.entries()) {
						if ((head[3 + index] ?? 0) !== place) return undefined;
					}
					if (((head[0] ?? 0) & 1) !== 0) return undefined;
					layout.width = head.readUInt16LE(6) & LOCATED_PLACES;
					layout.height = head.readUInt16LE(8) & LOCATED_PLACES;
				}
			}
			break;
		}
		if (mark.equals(ALPH_MARK)) {
			layout.alphaOffset = at + CHUNK_HEAD_SIZE;
			layout.alphaSize = chunkSize;
		}
		at += CHUNK_HEAD_SIZE + alignedSize;
	}
	if (layout.width === 0 || layout.height === 0) return undefined;
	return layout;
}

export const webpImageDescriptor: FormatDescriptor = {
	id: "webp-image",
	name: "Google WebP image format",
	extensions: ["webp"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/WebP/ImageWEBP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const webpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: webpImageDescriptor,
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(
				await source.readAt(0n, Math.min(Number(source.size), 0x1000)),
			);
			return readWebpLayout(data, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readWebpLayout(stored, Number(source.size));
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Not a picture of this kind");
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "webp"),
					offset: 0n,
					size: source.size,
					compressed: false,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						isLossless: layout.isLossless,
						hasAlpha: layout.hasAlpha,
						flags: layout.flags,
						dataOffset: layout.dataOffset,
						dataSize: layout.dataSize,
					},
				}),
			],
			metadata: {
				image: "webp",
				width: layout.width,
				height: layout.height,
				isLossless: layout.isLossless,
				hasAlpha: layout.hasAlpha,
				flags: layout.flags,
			},
		};
	},
	async openEntry(source: ByteSource) {
		return Readable.from([
			Buffer.from(await source.readAt(0n, Number(source.size))),
		]);
	},
});
