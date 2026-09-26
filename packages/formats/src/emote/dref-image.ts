// Port of GARbro "ArcFormats/Emote/ImageDREF.cs" (class `DrefFormat`), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. A picture of the E-mote engine that stands of no
// places of its own at all: a text of the places of its layers, every line naming an archive of the engine
// and an object of that archive, which the picture stands of one over another.
//
// The reference opens the archive of a line, stands of the object of that name, and draws it over the
// picture of the lines before it, of the counts of the places of the file of `WriteableBitmap` and of its
// own walk. This port resolves the names of the lines beside the file it was given, which is the same
// directory the reference stands of, and it stands of the same walk of the places of the file.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { readBmpImage, writeBmp32 } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";
import { decodeEmotePicture, readEmotePsbIndex } from "./psb-archive.js";

const BASELINE_COMMIT = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";
/** `DrefFormat.Signatures`: the words a file of the engine may begin with. */
export const DREF_SIGNATURES: readonly Buffer[] = [
	Buffer.from([0xff, 0xfe, 0x70, 0x00]), // the word of the places of the file of two places, and `p`
	Buffer.from([0xef, 0xbb, 0xbf, 0x70]), // the same of one place, and `p`
	Buffer.from("psb:", "latin1"),
	Buffer.from([0x70, 0x00, 0x73, 0x00]), // `ps` of the places of the file of two places each
];
/** `DrefFormat.PathRe`: the shape of a line of the file of the places of the layers. */
const DREF_LINE = /^psb:\/\/([^/]+)\/(.+)$/;

/** One layer of a picture of the engine: the archive it stands in, and the object of that archive. */
export interface DrefLayer {
	archive: string;
	entry: string;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `DrefFormat.ReadMetaData`: the places of the layers of a picture of the engine. */
export function readDrefLayers(data: Buffer): DrefLayer[] | undefined {
	const text = readDrefText(data);
	if (undefined === text) return undefined;
	const layers: DrefLayer[] = [];
	for (const line of text.split(/\r\n|\r|\n/)) {
		const trimmed = line.replace(/\0+$/, "");
		if (0 === trimmed.length) continue;
		const match = DREF_LINE.exec(trimmed);
		if (!match) return undefined;
		layers.push({ archive: match[1] ?? "", entry: match[2] ?? "" });
	}
	return 0 === layers.length ? undefined : layers;
}

/**
 * The places of the file of the text of a picture of the engine: the reference reads it of the places of
 * the file of one place each where the file begins of the word of such a text, and of the places of the
 * file of two places each where it begins of none.
 */
function readDrefText(data: Buffer): string | undefined {
	if (
		data.length >= 3 &&
		0xef === data[0] &&
		0xbb === data[1] &&
		0xbf === data[2]
	) {
		return data.toString("utf8", 3);
	}
	if (data.length >= 2 && 0xff === data[0] && 0xfe === data[1]) {
		return data.toString("utf16le", 2);
	}
	return data.toString("utf16le");
}

/**
 * `DrefFormat.BlendLayer`: the places of a layer of the engine drawn over the places of the picture behind
 * them. The places of the layer stand of the covering place of the layer alone, of the places of the
 * picture behind them where that covering place stands between nought and the whole of it, and nowhere at
 * all where it stands of nought.
 */
export function blendDrefLayer(
	canvas: { width: number; height: number; pixels: Buffer },
	layer: {
		width: number;
		height: number;
		offsetX: number;
		offsetY: number;
		pixels: Buffer;
	},
): void {
	for (let row = 0; row < layer.height; row += 1) {
		const y = layer.offsetY + row;
		if (y < 0 || y >= canvas.height) continue;
		for (let column = 0; column < layer.width; column += 1) {
			const x = layer.offsetX + column;
			if (x < 0 || x >= canvas.width) continue;
			const from = (row * layer.width + column) * 4;
			const at = (y * canvas.width + x) * 4;
			const alpha = layer.pixels[from + 3] ?? 0;
			if (0 === alpha) continue;
			if (0xff === alpha) {
				for (let place = 0; place < 3; place += 1) {
					canvas.pixels[at + place] = layer.pixels[from + place] ?? 0;
				}
			} else {
				for (let place = 0; place < 3; place += 1) {
					const source = layer.pixels[from + place] ?? 0;
					const behind = canvas.pixels[at + place] ?? 0;
					canvas.pixels[at + place] =
						((source * alpha + behind * (0xff - alpha)) / 0xff) | 0;
				}
			}
			canvas.pixels[at + 3] = Math.max(alpha, canvas.pixels[at + 3] ?? 0);
		}
	}
}

/** The places of a picture of the engine, of the object of an archive its lines name. */
async function readDrefLayer(
	path: string,
	name: string,
): Promise<
	| {
			width: number;
			height: number;
			offsetX: number;
			offsetY: number;
			pixels: Buffer;
	  }
	| undefined
> {
	let data: Buffer;
	try {
		data = await readFile(path);
	} catch {
		return undefined;
	}
	const plans = readEmotePsbIndex(data);
	if (!plans) return undefined;
	const plan = plans.find((candidate) => candidate.name === name);
	if (!plan) return undefined;
	const chunk = data.subarray(plan.offset, plan.offset + plan.size);
	if (!plan.picture) {
		// The reference stands of `ImageFormatDecoder.Create` for an object of no picture of its own: a
		// bitmap stands read here, and an object of another kind stands of no walk of this port.
		const picture = readBmpImage(Buffer.from(chunk));
		if (!picture) return undefined;
		return {
			width: picture.width,
			height: picture.height,
			offsetX: 0,
			offsetY: 0,
			pixels: picture.pixels,
		};
	}
	const metadata = plan.metadata as Record<string, unknown>;
	const places = decodeEmotePicture(metadata, Buffer.from(chunk));
	if (!places) return undefined;
	const picture = readBmpImage(places);
	if (!picture) return undefined;
	return {
		width: picture.width,
		height: picture.height,
		offsetX: Number(metadata.offsetX ?? 0),
		offsetY: Number(metadata.offsetY ?? 0),
		pixels: picture.pixels,
	};
}

/** `DrefFormat.Read`: the picture of the engine, of every layer of it one over another. */
export async function composeDrefPicture(
	data: Buffer,
	sourcePath: string,
): Promise<Buffer | undefined> {
	const layers = readDrefLayers(data);
	if (!layers) return undefined;
	const directory = dirname(resolve(sourcePath));
	let canvas: { width: number; height: number; pixels: Buffer } | undefined;
	for (const layer of layers) {
		const picture = await readDrefLayer(
			resolve(directory, layer.archive),
			layer.entry,
		);
		if (!picture) return undefined;
		if (!canvas) {
			canvas = {
				width: picture.width,
				height: picture.height,
				pixels: Buffer.from(picture.pixels),
			};
			continue;
		}
		blendDrefLayer(canvas, picture);
	}
	if (!canvas) return undefined;
	return writeBmp32(canvas.width, canvas.height, canvas.pixels);
}

export const emoteDrefDescriptor: FormatDescriptor = {
	id: "emote-dref-image",
	name: "E-mote compound picture of the places of its layers",
	extensions: ["dref"],
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
			source: "ArcFormats/Emote/ImageDREF.cs",
			license: "MIT",
			commit: BASELINE_COMMIT,
		},
	],
};

export const emoteDrefEntryOpener: FixedEntryOpener = async (
	source,
	_entry,
	sourcePath,
) => {
	const data = Buffer.from(await source.readAt(0n, Number(source.size)));
	const picture = await composeDrefPicture(data, sourcePath);
	if (!picture) {
		throw invalidPicture(
			"The picture of the engine and its layers stand of no walk",
		);
	}
	return Readable.from([picture]);
};

export const emoteDrefFormat: ArchiveFormat = defineFixedArchive({
	descriptor: emoteDrefDescriptor,
	detection: { signatures: DREF_SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			const data = Buffer.from(await source.readAt(0n, Number(source.size)));
			return readDrefLayers(data) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "picture.bmp",
				offset: 0n,
				size: source.size,
				compressed: false,
				metadata: { type: "image" } as Record<string, unknown>,
			}),
			sizeKnown: false,
		};
		return { entries: [entry], metadata: { count: 1, shape: "compound" } };
	},
	openEntry: emoteDrefEntryOpener,
});
