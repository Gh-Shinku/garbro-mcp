// Format reference: GARbro "ArcFormats/ScenePlayer/ImagePMP.cs", class `PmpFormat` (a bitmap inside a zlib
// stream that is masked with a single byte). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateZlibBufferCapped } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readBmpMetaData } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The mask the whole file is stored under. */
const XOR_KEY = 0x21;
/** The masked form of the zlib CMF byte, which is the only check the reference makes on the header. */
const MASKED_CMF = 0x78 ^ XOR_KEY;
/** A bound on the decompressed size, which the reference does not impose. */
const MAX_OUTPUT = 0x10000000;

function unmask(input: Buffer): Buffer {
	const output = Buffer.alloc(input.length);
	for (let i = 0; i < input.length; i += 1)
		output[i] = (input[i] ?? 0) ^ XOR_KEY;
	return output;
}

interface PmpLayout {
	bmp: Buffer;
	width: number;
	height: number;
	bitsPerPixel: number;
}

/**
 * `ReadMetaData` unmasks the stream, peeks at the first byte to see whether it can be a zlib header and then
 * reads the bitmap inside it. The check on the first byte is deliberately weak — a masked `0x78` is only one
 * value out of 256 — so acceptance really rests on the decompression succeeding and on the payload being a
 * bitmap, exactly as in the reference.
 */
async function readLayout(source: ByteSource): Promise<PmpLayout | undefined> {
	if (source.size < 2n) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, 1));
		if ((head[0] ?? 0) !== MASKED_CMF) return undefined;
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const inflated = unmask(stored);
		const bmp = Buffer.from(
			await inflateZlibBufferCapped(inflated, MAX_OUTPUT),
		);
		const meta = readBmpMetaData(bmp);
		if (!meta) return undefined;
		return {
			bmp: bmp.subarray(0, meta.fileSize),
			width: meta.width,
			height: meta.height,
			bitsPerPixel: meta.bitsPerPixel,
		};
	} catch {
		return undefined;
	}
}

export const pmpImageDescriptor: FormatDescriptor = {
	id: "sceneplayer-pmp-image",
	name: "ScenePlayer compressed bitmap format",
	extensions: ["pmp"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/ScenePlayer/ImagePMP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const pmpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pmpImageDescriptor,
	// The reference declares no signature and no extension gate, so every file is a candidate and detection
	// has to decompress before it can answer.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ScenePlayer PMP image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				encrypted: true,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// The stored stream is masked and compressed, and a bitmap header is part of the payload.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "zlib",
				encrypted: true,
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ScenePlayer PMP image");
		return Readable.from([layout.bmp]);
	},
});
