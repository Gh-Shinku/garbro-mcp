// Format reference: GARbro "ArcFormats/uGOS/ImageTXT.cs", classes `TxtFormat`, `TxtMetaData` and `Tile` (a
// picture of the μ-GameOperationSystem engine that stands as words rather than as places of a picture: the
// first words name how wide and how tall the picture stands and how many places of a picture a place of a tile
// of it stands in, and every words behind those name a place of a picture of its own and where it stands in the
// picture). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveEntry,
	ArchiveFormat,
	ArchiveHandle,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { createFixedEntry } from "../shared/fixed-archive.js";

/** The words of a picture of this kind stand as the words of the engine, which stand in a file of this kind
 * rather than in the places of a picture, and the file stands at `0x1000` places or fewer. */
const PLACES_WORD = ".txt";
const MAXIMUM_SIZE = 0x1000;
/** The first words of the file name how wide and how tall the picture stands and how many places of a picture a
 * place of a tile of it stands in. */
const HEAD_WORDS = /^\s*(\d+),\s*(\d+),\s*(\d+)$/;
/** Every words behind those name a place of a picture of its own and where it stands in the picture, the
 * places of it standing beside the place the words name rather than behind it. */
const TILE_WORDS = /^.+@(\d+),(\d+)\..*$/;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface UgoTile {
	/** The words the file names the place of the picture with, as they stand in the file. */
	fileName: string;
	/** Where the place of the picture stands along its row and along its column, in places of the picture. */
	x: number;
	y: number;
}

export interface UgoTxtLayout {
	width: number;
	height: number;
	tileSize: number;
	tiles: UgoTile[];
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `TxtFormat.ReadMetaData`: the first words of a file of this kind stand as the words of a file of the kind of
 * files that name the places of a picture, and name how wide and how tall the picture stands and how many
 * places of a picture a place of a tile of it stands in; every words behind those name a place of a picture of
 * its own and where it stands in the picture, the places of which stand behind the place the words name rather
 * than beside it.
 */
export function readUgoTxtLayout(
	data: Buffer,
	fileLength = data.length,
): UgoTxtLayout | undefined {
	if (fileLength > MAXIMUM_SIZE) return undefined;
	const words = data.toString("latin1").split(/\r?\n/);
	const first = words[0] ?? "";
	if (first.length === 0) return undefined;
	const head = HEAD_WORDS.exec(first);
	if (!head) return undefined;
	const width = Number.parseInt(head[1] ?? "", 10);
	const height = Number.parseInt(head[2] ?? "", 10);
	const tileSize = Number.parseInt(head[3] ?? "", 10);
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
		return undefined;
	}
	if (width <= 0 || height <= 0 || width * height > LIMIT) return undefined;
	if (!Number.isSafeInteger(tileSize) || tileSize <= 0) return undefined;
	const tiles: UgoTile[] = [];
	for (let at = 1; at < words.length; at += 1) {
		const line = words[at] ?? "";
		// The reference reads every words behind the first as the words of a place of a picture and stops at
		// the first words that stand as none of them; a file of this kind ends with a place of no words, so the
		// words of no places at all stand as the end of it.
		if (line.length === 0) break;
		const tile = TILE_WORDS.exec(line);
		if (!tile) return undefined;
		const first = Number.parseInt(tile[1] ?? "", 10);
		const second = Number.parseInt(tile[2] ?? "", 10);
		if (!Number.isSafeInteger(first) || !Number.isSafeInteger(second)) {
			return undefined;
		}
		tiles.push({
			fileName: line,
			// The reference stands the places of a picture of its own beside the place the words name rather
			// than behind it.
			x: second * tileSize,
			y: first * tileSize,
		});
	}
	if (tiles.length === 0) return undefined;
	return { width, height, tileSize, tiles };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

function hasTxtWord(sourcePath: string | undefined): boolean {
	if (!sourcePath) return false;
	return sourcePath.toLowerCase().endsWith(PLACES_WORD);
}

class UgoTxtHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = ugoTxtDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly ArchiveEntry[];
	readonly #layout: UgoTxtLayout;

	constructor(source: ByteSource, sourcePath: string, layout: UgoTxtLayout) {
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.#layout = layout;
		this.entries = layout.tiles.map((tile, at) =>
			createFixedEntry({
				id: at,
				path: tile.fileName,
				offset: 0n,
				// The places of a place of a picture of this kind stand beside the file rather than in it.
				size: 0n,
				compressed: false,
				metadata: { type: "image", x: tile.x, y: tile.y },
			}),
		);
		this.metadata = {
			entryCount: this.entries.length,
			width: layout.width,
			height: layout.height,
			tileSize: layout.tileSize,
		};
	}

	async openEntry(id: string): Promise<Readable> {
		const at = this.entries.findIndex((entry) => entry.id === id);
		const tile = at < 0 ? undefined : this.#layout.tiles[at];
		if (!tile) throw invalidPicture("No such place in the picture");
		// `VFS.CombinePath`: the reference reads the places of a place of a picture beside the words that name
		// them.
		const at_path = resolve(dirname(this.sourcePath), tile.fileName);
		try {
			return Readable.from([await readFile(at_path)]);
		} catch {
			throw invalidPicture(
				"μ-GameOperationSystem picture stands without the places of a tile of its own",
			);
		}
	}

	async close(): Promise<void> {}
}

export const ugoTxtDescriptor: FormatDescriptor = {
	id: "ugos-txt-image",
	name: "μ-GameOperationSystem tiled bitmap",
	extensions: ["txt"],
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
			source: "ArcFormats/uGOS/ImageTXT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ugoTxtFormat: ArchiveFormat = {
	descriptor: ugoTxtDescriptor,
	// The reference registers no word of its own and tells a picture of this kind by the words of the kind of
	// files it stands as, which every file of that kind stands as.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		if (!hasTxtWord(sourcePath)) return false;
		if (source.size > BigInt(MAXIMUM_SIZE)) return false;
		try {
			return (
				readUgoTxtLayout(await readStored(source), Number(source.size)) !==
				undefined
			);
		} catch {
			return false;
		}
	},
	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		if (!hasTxtWord(sourcePath)) {
			throw invalidPicture("Not a μ-GameOperationSystem picture");
		}
		const layout = readUgoTxtLayout(
			await readStored(source),
			Number(source.size),
		);
		if (!layout) throw invalidPicture("Not a μ-GameOperationSystem picture");
		return new UgoTxtHandle(source, sourcePath, layout);
	},
};
