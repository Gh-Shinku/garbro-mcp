// Format reference: GARbro "Legacy/Adviz/ImageBIZ.cs", the palette of the engine (`ReadPalette`) together with
// the table of mappers of the places of a palette (`GrpMap`) and the three kinds of mapper. This project
// implements the palette of a picture of a BIZ or a GIZ/2 picture.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** The words of the two companions of the engine that stand beside a picture of its kind rather than within
 * it: the table of the words of the places of a picture and the table of the palettes of them. */
const GROUP_TABLE_NAME = "GRP_TBL.SYS";
const PALETTE_TABLE_NAME = "PLT_TBL.SYS";
/** Every record of the table of the words of the places of a picture stands in twelve places: eight places of
 * words and four of the words behind them. */
const GROUP_RECORD_SIZE = 12;
const GROUP_NAME_SIZE = 8;
/** The words of a picture of the places of a picture of a person stand as the words of the first place of the
 * picture of that person, so that the words of the kind of the picture stand behind them. */
const TACHIE_WORDS = /^(T[^._]+_)[2-9][^.]*\.GIZ$/;
/** The shortest words the places of a picture of a person stand in, which stand padded to them with places. */
const SHORTEST_NAME = 8;

export interface PaletteMapper {
	grpSize: number;
	pltSize: number;
	/** How far along the palettes of the table of palettes the place of a palette of a picture stands. */
	shift?: number;
	/** The place of the palette of a picture, for the pictures the table names. */
	names?: Readonly<Record<string, number>>;
}

const PALETTE_MAPPERS: readonly PaletteMapper[] = [
	{ grpSize: 1584, pltSize: 139008, shift: 52 },
	{
		grpSize: 2160,
		pltSize: 12288,
		names: {
			"BG01.BIZ": 14,
			"BG02.BIZ": 8,
			"BG03.BIZ": 8,
			"BG04.BIZ": 8,
			"BG05.BIZ": 8,
			"BG06.BIZ": 8,
			"BG07.BIZ": 8,
			"BG08.BIZ": 8,
			"BG09.BIZ": 8,
			"BG10.BIZ": 8,
			"BG11.BIZ": 8,
			"BG12.BIZ": 8,
			"BG13.BIZ": 8,
			"BG14.BIZ": 8,
			"BG15.BIZ": 8,
			"BG16.BIZ": 8,
			"BG17.BIZ": 8,
			"BG18.BIZ": 8,
			"BG19.BIZ": 8,
			"CA01.BIZ": 12,
			"CA02.BIZ": 12,
			"CA03.BIZ": 4,
			"CA04.BIZ": 8,
			"CA05.BIZ": 8,
			"CA06.BIZ": 8,
			"CA07.BIZ": 8,
			"CA08.BIZ": 8,
			"CA09.BIZ": 8,
			"CA10.BIZ": 8,
			"CA11.BIZ": 8,
			"CA12.BIZ": 8,
			"CA13.BIZ": 8,
			"CA14.BIZ": 8,
			"CA15.BIZ": 8,
			"CA16.BIZ": 8,
			"CA17.BIZ": 8,
			"CA18.BIZ": 8,
			"CA19.BIZ": 8,
			"CA20.BIZ": 8,
			"CA21.BIZ": 8,
			"CA22.BIZ": 8,
			"CA23.BIZ": 8,
			"CA24.BIZ": 8,
			"CA25.BIZ": 8,
			"CA26.BIZ": 8,
			"CA27.BIZ": 8,
			"CA28.BIZ": 8,
			"CA29.BIZ": 8,
			"CA30.BIZ": 8,
			"CA31.BIZ": 8,
			"CA32.BIZ": 8,
			"CA33.BIZ": 8,
			"CA34.BIZ": 8,
			"CA35.BIZ": 8,
			"CA36.BIZ": 8,
			"CA37.BIZ": 8,
			"CA38.BIZ": 8,
			"CA39.BIZ": 8,
			"CA40.BIZ": 8,
			"CA41.BIZ": 8,
			"CA42.BIZ": 8,
			"CA43.BIZ": 8,
			"CA44.BIZ": 8,
			"CA45.BIZ": 8,
			"CA46.BIZ": 8,
			"CA47.BIZ": 8,
			"CA48.BIZ": 8,
			"CA49.BIZ": 8,
			"CA50.BIZ": 8,
			"CA51.BIZ": 8,
			"CA52.BIZ": 8,
			"CA53.BIZ": 8,
			"CA54.BIZ": 8,
			"CA55.BIZ": 8,
			"CA56.BIZ": 8,
			"CA57.BIZ": 8,
			"CA58.BIZ": 8,
			"CA59.BIZ": 8,
			"CA60.BIZ": 8,
			"E02.BIZ": 8,
			"E03.BIZ": 8,
			"E04.BIZ": 8,
			"E05.BIZ": 8,
			"E06.BIZ": 8,
			"E07.BIZ": 8,
			"E08.BIZ": 8,
			"E09.BIZ": 8,
			"E10.BIZ": 8,
			"E11.BIZ": 8,
			"E12.BIZ": 8,
			"E13.BIZ": 8,
			"E14.BIZ": 8,
			"E15.BIZ": 8,
			"E16.BIZ": 8,
			"E17.BIZ": 8,
			"E18.BIZ": 8,
			"END.BIZ": 6,
			"IPL.BIZ": 12,
			"S01.BIZ": 8,
			"S02.BIZ": 8,
			"S03.BIZ": 8,
			"S04.BIZ": 8,
			"S05.BIZ": 8,
			"S06.BIZ": 8,
			"S07.BIZ": 8,
			"S08.BIZ": 8,
			"S09.BIZ": 8,
			"S10.BIZ": 8,
			"S11.BIZ": 8,
			"S12.BIZ": 8,
			"S13.BIZ": 8,
			"S14.BIZ": 8,
			"S15.BIZ": 8,
			"S16.BIZ": 8,
			"S17.BIZ": 8,
			"S18.BIZ": 8,
			"S19.BIZ": 8,
			"S20.BIZ": 8,
			"S21.BIZ": 8,
			"S22.BIZ": 8,
			"S23.BIZ": 8,
			"S24.BIZ": 8,
			"S25.BIZ": 8,
			"S26.BIZ": 8,
			"S27.BIZ": 8,
			"S28.BIZ": 8,
			"S29.BIZ": 8,
			"S30.BIZ": 8,
			"S31.BIZ": 8,
			"S32.BIZ": 8,
			"S33.BIZ": 8,
			"S34.BIZ": 8,
			"S35.BIZ": 8,
			"S36.BIZ": 8,
			"S37.BIZ": 8,
			"S38.BIZ": 8,
			"S39.BIZ": 8,
			"S40.BIZ": 8,
			"S41.BIZ": 8,
			"S42.BIZ": 8,
			"S43.BIZ": 8,
			"S44.BIZ": 8,
			"S45.BIZ": 8,
			"S46.BIZ": 8,
			"S47.BIZ": 8,
			"S48.BIZ": 8,
			"S49.BIZ": 8,
			"T01.BIZ": 8,
			"T02.BIZ": 8,
			"T03.BIZ": 8,
			"WAKU1.BIZ": 8,
			"WAKU2.BIZ": 8,
		},
	},
];

/** Every kind of the places of the palettes of the engine, told by the sizes of the two companions it stands
 * with. A picture stands with a place of its own where the table names no kind. */
const MAPPER_BY_TABLE_SIZES = new Map<string, PaletteMapper>(
	PALETTE_MAPPERS.map((mapper) => [
		`${mapper.grpSize}:${mapper.pltSize}`,
		mapper,
	]),
);

export interface AdvizPalette {
	/** The places of the palette, as the places of a picture of the kind the reference stands them in. */
	colors: Buffer;
	/** The place of the palette within the table of palettes. */
	index: number;
	/** The kind of the places of the palettes the two companions stood in, where the table names one. */
	mapper: PaletteMapper | undefined;
}

function invalidPalette(message: string): never {
	throw new Error(message);
}

/**
 * `BizFormat.ReadPalette`: the palette of a picture of the engine stands in the table of palettes of the
 * engine, at the place the table of the words of the places of a picture names for the words of the picture,
 * told by the sizes of the two companions where the pair names a kind of its own.
 */
export async function readAdvizPalette(
	sourcePath: string,
	paletteSize: number,
	readPalette: (data: Buffer, offset: number) => Buffer,
): Promise<AdvizPalette | undefined> {
	const directory = dirname(sourcePath);
	const groupPath = join(directory, "..", GROUP_TABLE_NAME);
	const palettePath = join(directory, "..", PALETTE_TABLE_NAME);
	let group: Buffer;
	let palettes: Buffer;
	try {
		group = await readFile(groupPath);
	} catch {
		return undefined;
	}
	try {
		palettes = await readFile(palettePath);
	} catch {
		return undefined;
	}
	const grpSize = group.length;
	const pltSize = palettes.length;

	const fileName = sourcePath.replace(/^.*[/\\]/, "").toUpperCase();
	const dot = fileName.lastIndexOf(".");
	const extension = dot < 0 ? "" : fileName.slice(dot + 1);
	const tachie = TACHIE_WORDS.exec(fileName);
	let name = tachie
		? `${tachie[1] ?? ""}1`
		: dot < 0
			? fileName
			: fileName.slice(0, dot);
	// The reference stands the shortest words of a picture padded to the words of the places of a picture with
	// a single place, whatever the places the words stand short of them.
	if (name.length < SHORTEST_NAME) name += " ";

	let index = 0;
	let at = 0;
	let found = false;
	while (at + GROUP_RECORD_SIZE <= grpSize) {
		if (
			group.toString("latin1", at, at + name.length) === name &&
			group.toString(
				"latin1",
				at + GROUP_NAME_SIZE,
				at + GROUP_NAME_SIZE + extension.length,
			) === extension
		) {
			found = true;
			break;
		}
		index += 1;
		at += GROUP_RECORD_SIZE;
	}
	if (!found || at >= grpSize) return undefined;

	// The reference reads the words of the picture as they stand rather than as the filled words the table of
	// the words of the places of a picture stands them in, so the kind of the places of the palettes is told
	// by the words of the picture itself.
	const mapper = MAPPER_BY_TABLE_SIZES.get(`${grpSize}:${pltSize}`);
	const named = mapper?.names?.[fileName];
	const placed = named ?? index + (mapper?.shift ?? 0);
	let offset = placed * paletteSize;
	// The reference stands the place of a palette of its own where the place the table of the words of the
	// places of a picture names stands beyond the palettes the table of palettes holds, so the place stands
	// shortened by places of a palette at a time rather than at a place of a palette.
	if (offset + paletteSize > pltSize)
		offset = (Math.floor(pltSize / paletteSize) - 1) * paletteSize;
	if (offset < 0)
		invalidPalette("The table of palettes stands short of a palette");
	return {
		colors: readPalette(palettes, offset),
		index: placed,
		mapper,
	};
}
