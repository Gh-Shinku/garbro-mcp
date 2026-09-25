// Format reference: GARbro "Experimental/Artemis/ImageIPT.cs" with the language of "IPT.Language.grammar.y"
// and "IPT.Language.analyzer.lex" (tag `IPT`, the composite picture of the Artemis engine). The reference
// reads the language with a parser of its own making (Gplex/gpgen); this port reads the same language with a
// small reader of its own, which is written out in the notes of the format. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readPngImage, type PngImage } from "../shared/png-image.js";

const PLACE_SIZE = 4;
const BITS_32 = 32;
const LIMIT = 256 * 1024 * 1024;
/** The picture of a canvas of this engine stands of a kind of its own. */
const MODE_CUT = "cut";
const MODE_DIFF = "diff";
/** The name of the picture the canvas stands on, and the word the head of the file opens with. */
const ROOT_NAME = "ipt";
const CANVAS_NAME = "base";
const PNG_NAME = ".png";

interface IptObject {
	fields: Map<string, IptValue>;
	values: IptValue[];
}

type IptValue = IptObject | string | number;

export interface IptTile {
	id: number;
	fileName: string;
	x: number;
	y: number;
}

export interface IptLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	mode: string;
	baseName: string;
	tiles: IptTile[];
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The words of the language a picture is written in: a place of a colour, a word and three of its own. */
const WORD = /^[a-zA-Z]+/;
const NUMBER = /^[0-9]+/;
const STRING = /^"(?:\\.|[^\\"\n])*"/;
const SPACE = /^[ \t\v\n\f]+/;

function isObject(value: IptValue): value is IptObject {
	return "object" === typeof value;
}

/**
 * The picture the file names, read of the words of its own language: `name = { field = value ... value }`,
 * of which the words and the places of the file stand of letters, words and place of strings alone. A place
 * of a string keeps the places behind its backslash as they stand, which is the reading of the reference.
 */
export function parseIpt(data: Buffer): IptObject | undefined {
	const text = data.toString("latin1");
	let at = 0;
	const skip = (): void => {
		for (;;) {
			const space = SPACE.exec(text.slice(at));
			if (!space) break;
			at += space[0].length;
		}
	};
	const readWord = (): string => {
		skip();
		const word = WORD.exec(text.slice(at));
		if (!word)
			throw invalidPicture("The words of the picture stand of nothing");
		at += word[0].length;
		return word[0];
	};
	const readValue = (): IptValue => {
		skip();
		const rest = text.slice(at);
		if ("{" === rest[0]) return readObject();
		const number = NUMBER.exec(rest);
		if (number) {
			at += number[0].length;
			return Number.parseInt(number[0], 10);
		}
		const string = STRING.exec(rest);
		if (string) {
			at += string[0].length;
			return string[0].slice(1, -1);
		}
		throw invalidPicture("The places of the picture stand of nothing");
	};
	const readObject = (): IptObject => {
		skip();
		if ("{" !== text[at])
			throw invalidPicture("The picture stands of no places");
		at += 1;
		const object: IptObject = { fields: new Map(), values: [] };
		for (;;) {
			skip();
			if ("}" === text[at]) {
				at += 1;
				return object;
			}
			if ("," === text[at]) {
				at += 1;
				continue;
			}
			// A word standing in front of a place of a colour names a field; every other place stands of its
			// own among the places of the object.
			let name: string | undefined;
			const saved = at;
			if (WORD.test(text.slice(at, at + 1))) {
				try {
					name = readWord();
				} catch {
					name = undefined;
				}
			}
			skip();
			if (undefined !== name && "=" === text[at]) {
				at += 1;
				object.fields.set(name, readValue());
				continue;
			}
			at = saved;
			object.values.push(readValue());
		}
	};
	const name = readWord();
	skip();
	if ("=" !== text[at])
		throw invalidPicture("The picture stands of no place of its own");
	at += 1;
	const root = readObject();
	return name === ROOT_NAME ? root : undefined;
}

function fieldNumber(object: IptObject, name: string): number | undefined {
	const value = object.fields.get(name);
	return "number" === typeof value ? value : undefined;
}

/** `IptFormat.ReadMetaData`: the canvas of the picture and the places of it. */
export function readIptLayout(data: Buffer): IptLayout | undefined {
	// The reference keeps the picture the file names in a place of its own under the word `ipt`; the reader
	// of the language hands that picture over itself.
	const ipt = parseIpt(data);
	if (!ipt) return undefined;
	const mode = ipt.fields.get("mode");
	const canvas = ipt.fields.get(CANVAS_NAME);
	if ("string" !== typeof mode || !canvas || !isObject(canvas))
		return undefined;
	const tiles: IptTile[] = [];
	for (const value of ipt.values) {
		// The reference hands every place of the picture over as a place of a tile; a place of another kind
		// among them stands of no tile at all.
		if (!isObject(value)) return undefined;
		const id = value.fields.get("id");
		const file = value.fields.get("file");
		const x = value.fields.get("x");
		const y = value.fields.get("y");
		if (
			"number" !== typeof id ||
			"string" !== typeof file ||
			"number" !== typeof x ||
			"number" !== typeof y
		) {
			return undefined;
		}
		tiles.push({ id, fileName: file, x, y });
	}
	if (MODE_CUT === mode && 0 === tiles.length) return undefined;
	const width = fieldNumber(canvas, "w");
	const height = fieldNumber(canvas, "h");
	const offsetX = fieldNumber(canvas, "x");
	const offsetY = fieldNumber(canvas, "y");
	const baseName = canvas.values[0];
	if (
		undefined === width ||
		undefined === height ||
		undefined === offsetX ||
		undefined === offsetY ||
		"string" !== typeof baseName
	) {
		return undefined;
	}
	if (width <= 0 || height <= 0 || width * height > LIMIT) return undefined;
	if (MODE_CUT !== mode && MODE_DIFF !== mode) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`A picture standing of the kind '${mode}' is not read`,
		);
	}
	return {
		width,
		height,
		offsetX,
		offsetY,
		mode,
		baseName,
		tiles,
	};
}

/** The name of a picture standing beside the descriptor of it, which may not reach outside its directory. */
function tilePath(sourcePath: string, name: string): string {
	const parts = name.split(/[/\\]/);
	if (parts.includes("..") || "" === name) {
		throw new GarbroError(
			"UNSAFE_PATH",
			`The name of a picture stands outside its own directory`,
		);
	}
	return join(dirname(sourcePath), `${name}${PNG_NAME}`);
}

/** `IptFormat.ReadIntoCanvas`: the places of a picture standing over the places of the canvas. */
function drawIntoCanvas(
	canvas: Buffer,
	layout: IptLayout,
	tile: PngImage,
	x: number,
	y: number,
	blend: boolean,
): void {
	if (y >= layout.height || x >= layout.width) return;
	// A picture standing to the left of the canvas or above it stands of the places of its own that stand
	// over the canvas. The reference walks its own places from the corner it was given, which stands before
	// the canvas where that corner stands outside it; this port keeps the places of the picture.
	const sourceX = x >= 0 ? 0 : -x;
	const sourceY = y >= 0 ? 0 : -y;
	const targetX = Math.max(x, 0);
	const targetY = Math.max(y, 0);
	const width = Math.min(tile.width - sourceX, layout.width - targetX);
	const height = Math.min(tile.height - sourceY, layout.height - targetY);
	if (width <= 0 || height <= 0) return;
	const stride = layout.width * PLACE_SIZE;
	const tileStride = tile.width * PLACE_SIZE;
	for (let row = 0; row < height; row += 1) {
		for (let column = 0; column < width; column += 1) {
			const source =
				(sourceY + row) * tileStride + (sourceX + column) * PLACE_SIZE;
			const destination =
				(targetY + row) * stride + (targetX + column) * PLACE_SIZE;
			const alpha =
				32 === tile.bitsPerPixel ? (tile.pixels[source + 3] ?? 0) : 0;
			if (!blend || 32 !== tile.bitsPerPixel) {
				tile.pixels.copy(canvas, destination, source, source + PLACE_SIZE);
				continue;
			}
			if (0 === alpha) continue;
			if (0xff === alpha || 0 === (canvas[destination + 3] ?? 0)) {
				canvas[destination] = tile.pixels[source] ?? 0;
				canvas[destination + 1] = tile.pixels[source + 1] ?? 0;
				canvas[destination + 2] = tile.pixels[source + 2] ?? 0;
			} else {
				for (let place = 0; place < 3; place += 1) {
					const over = tile.pixels[source + place] ?? 0;
					const under = canvas[destination + place] ?? 0;
					canvas[destination + place] =
						Math.trunc((over * alpha + under * (0xff - alpha)) / 0xff) & 0xff;
				}
			}
			canvas[destination + 3] = alpha;
		}
	}
}

async function readTile(
	sourcePath: string,
	name: string,
): Promise<PngImage | undefined> {
	const path = tilePath(sourcePath, name);
	let data: Buffer;
	try {
		data = await readFile(path);
	} catch {
		throw new GarbroError(
			"IO_ERROR",
			`The picture '${path}' stands of nothing`,
		);
	}
	const image = await readPngImage(data);
	if (!image) throw invalidPicture(`The picture '${path}' stands of no places`);
	return image;
}

/** `IptFormat.Read`: the canvas of the picture, of the places of the pictures standing beside it. */
export async function renderIptImage(
	data: Buffer,
	sourcePath: string,
): Promise<Buffer> {
	const layout = readIptLayout(data);
	if (!layout) throw invalidPicture("Not a picture of the Artemis engine");
	const canvas: Buffer = Buffer.alloc(
		layout.width * layout.height * PLACE_SIZE,
		0x00,
	);
	if (MODE_DIFF === layout.mode) {
		const base = await readTile(sourcePath, layout.baseName);
		if (base) drawIntoCanvas(canvas, layout, base, 0, 0, false);
	}
	for (const tile of layout.tiles) {
		const image = await readTile(sourcePath, tile.fileName);
		if (image) drawIntoCanvas(canvas, layout, image, tile.x, tile.y, true);
	}
	if (MODE_DIFF === layout.mode) {
		// The picture of this kind stands of three colours: the reference hands it over without the places
		// of an alpha, which the places of the pictures beside it may have left in the canvas.
		for (let at = 3; at < canvas.length; at += PLACE_SIZE) canvas[at] = 0x00;
	}
	return writeBmp32(layout.width, layout.height, canvas);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const iptImageDescriptor: FormatDescriptor = {
	id: "artemis-ipt-image",
	name: "Artemis composite picture",
	extensions: ["ipt"],
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
			source: "Experimental/Artemis/ImageIPT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const iptImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: iptImageDescriptor,
	// The reference tells the picture by the name of the file alone, and then by the words of the picture.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < 4n) return false;
		try {
			return readIptLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readIptLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Artemis engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: BITS_32,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
					mode: layout.mode,
					tiles: layout.tiles.length,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_32,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		return Readable.from([
			await renderIptImage(await readStored(source), sourcePath),
		]);
	},
});
