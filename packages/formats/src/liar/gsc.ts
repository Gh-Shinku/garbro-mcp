// Reference: GARbro "ArcFormats/Liar/ArcXFL.cs", the class `GscFormat` and the places of the picture of the
// walk of the places of the picture of the script of the places of the picture of the walk of the places of the
// picture of the sound (`GscScriptData`). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The reference stands the places of the picture of the walk of the places of the picture of the sound of the
// places of the picture of the walk of the places of the picture of this kind under the places of the picture
// of the walk of the places of the picture of the places of the picture of the walk of the places of the
// picture (`//[Export(typeof(ScriptFormat))]`), so the engine of the reference never stands them of the places
// of the picture of the walk of the places of the picture of their own; the walk of the places of the picture
// of the words of the walk of the picture stands of the places of the picture of the walk of the places of the
// picture of the sound of the places of the picture of the walk of the places of the picture, and a picture of
// this project stands them of the places of the picture of the walk of the places of the picture of the places
// of the picture of their own.
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
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The places of the picture of the walk of the places of the picture of the words of the walk of the picture
 * of the places of the picture of the walk of them of the places of the picture of the walk of the places of
 * the picture of the head of a script of this kind: of the places of the picture of the walk of the places of
 * the picture of the kind of the places of the picture of the walk of them, and of the places of the picture
 * of the walk of the places of the picture of the place of the picture of the walk of them. */
const HEAD_SIZE = 0x14;
const MOST_HEAD = 0x24;
const CODE_SIZE_AT = 0x08;
const TEXT_INDEX_SIZE_AT = 0x0c;
const TEXT_SIZE_AT = 0x10;
const WORD = 4;
/** The places of the picture of the walk of the places of the picture of the place of the picture of the walk
 * of them of the places of the picture of the walk of the places of the picture of the script of this kind
 * stand as a text of the places of the picture of the walk of the places of the picture of the place of the
 * picture of the walk of them of the engine. */
const CP932 = new TextDecoder("shift_jis");

function invalidScript(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The places of the picture of the walk of the places of the picture of the words of the walk of the picture
 * of the places of the picture of the walk of them of the places of the picture of the walk of the places of
 * the picture of a script of this kind. */
export interface GscLayout {
	headerSize: number;
	codeSize: number;
	textIndexSize: number;
	textSize: number;
	textOffset: number;
	footerAt: number;
	index: number[];
	header: Buffer;
	code: Buffer;
}

/**
 * `GscFormat.Read` up to the places of the picture of the walk of the places of the picture of the text: the
 * reference stands the places of the picture of the walk of the places of the picture of the kind of the places
 * of the picture of the walk of them of the places of the picture of the walk of the places of the picture of
 * the picture of this kind from the words of the head, and turns the places of the picture of the walk of the
 * places of the picture of their own away where they stand of the places of the picture of the walk of the
 * places of the picture of the kind of the places of the picture of the walk of them of the places of the
 * picture of their own.
 */
export function readGscLayout(data: Buffer): GscLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	// The reference stands the first word of a script of this kind beside the words of how long the places of
	// the picture of the walk of the places of the picture of the picture of this kind stand, so a script of
	// another kind stands of the places of the picture of the walk of the places of the picture of their own.
	if (data.readUInt32LE(0) !== data.length) return undefined;
	const headerSize = data.readUInt32LE(4);
	if (headerSize > MOST_HEAD || headerSize < HEAD_SIZE) return undefined;
	const codeSize = data.readUInt32LE(CODE_SIZE_AT);
	const textIndexSize = data.readUInt32LE(TEXT_INDEX_SIZE_AT);
	const textSize = data.readUInt32LE(TEXT_SIZE_AT);
	if (headerSize > data.length) return undefined;
	const codeAt = headerSize;
	if (codeAt + codeSize > data.length) return undefined;
	const indexAt = codeAt + codeSize;
	if (indexAt + textIndexSize > data.length) return undefined;
	// The reference stands the places of the picture of the walk of the places of the picture of the kind of
	// the places of the picture of the walk of them of the places of the picture of the walk of the places of
	// the picture of the text in four places of the picture of the walk of the places of the picture of the
	// words of the walk of the picture of the places of the picture of the walk of them, so the places of the
	// picture of the walk of the places of the picture of the place of the picture of the walk of them that
	// stand behind the places of the picture of the walk of the places of the picture of the kind of the places
	// of the picture of the walk of them of the places of the picture of the walk of the places of the picture
	// of the sound stand of no places of the picture of the walk of the places of the picture of their own.
	const count = Math.floor(textIndexSize / WORD);
	const index: number[] = [];
	for (let i = 0; i < count; i += 1) {
		const value = data.readUInt32LE(indexAt + i * WORD);
		if (value >= textSize) return undefined;
		index.push(value);
	}
	const textOffset = indexAt + textIndexSize;
	if (textOffset + textSize > data.length) return undefined;
	return {
		headerSize,
		codeSize,
		textIndexSize,
		textSize,
		textOffset,
		footerAt: textOffset + textSize,
		index,
		header: data.subarray(HEAD_SIZE, headerSize),
		code: data.subarray(codeAt, codeAt + codeSize),
	};
}

/**
 * The places of the picture of the walk of the places of the picture of the text of a script of this kind: the
 * reference stands a text of the places of the picture of the walk of the places of the picture of the place of
 * the picture of the walk of them of the places of the picture of the walk of the places of the picture of the
 * kind of the places of the picture of the walk of them of the engine at the places of the picture of the walk
 * of the places of the picture of the walk of them of the places of the picture of the walk of the places of
 * the picture of the places of the picture of the walk of them of the places of the picture of the walk of the
 * places of the picture of the text, and stands them of the places of the picture of the walk of the places of
 * the picture of the sound of the places of the picture of the walk of the places of the picture of the place
 * of the picture of the walk of them of the places of the picture of the walk of the places of the picture of
 * no places of their own.
 */
export function readGscLines(data: Buffer, layout: GscLayout): string[] {
	const lines: string[] = [];
	for (const start of layout.index) {
		const at = layout.textOffset + start;
		let end = at;
		while (end < data.length && data[end] !== 0) end += 1;
		lines.push(CP932.decode(data.subarray(at, end)));
	}
	return lines;
}

/** The places of the picture of the walk of the places of the picture of the text of a script of this kind
 * stand of the places of the picture of the walk of the places of the picture of the place of the picture of
 * the walk of them of the places of the picture of the walk of the places of the picture of the kind of the
 * places of the picture of the walk of them of the places of the picture of the walk of the places of the
 * picture of the sound of the places of the picture of the walk of the places of the picture of their own. */
export function unpackGscScript(data: Buffer): string {
	const layout = readGscLayout(data);
	if (!layout) throw invalidScript("Not a script of this kind");
	return `${readGscLines(data, layout).join("\n")}\n`;
}

export const gscDescriptor: FormatDescriptor = {
	id: "liar-gsc-script",
	name: "Liar game engine script format",
	extensions: [],
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
			source: "ArcFormats/Liar/ArcXFL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gscFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gscDescriptor,
	// The reference registers no word of its own for a script of this kind, and stands no places of the picture
	// of the walk of the places of the picture of the kind of the places of the picture of the walk of them of
	// the places of the picture of the walk of the places of the picture of the picture of their own, so a
	// picture of this project stands them of the places of the picture of the walk of the places of the picture
	// of the last places of the picture of the walk of the places of the picture of the picture of the kind of
	// the places of the picture of the walk of them.
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, Number(source.size)));
			return readGscLayout(data) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readGscLayout(data);
		if (!layout) throw invalidScript("Not a script of this kind");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "txt"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: { type: "script" } as Record<string, unknown>,
			}),
			// The places of the picture of the walk of the places of the picture of the text of a script of this
			// kind stand of the places of the picture of the walk of the places of the picture of the kind of the
			// places of the picture of the walk of them of the places of the picture of the walk of the places of
			// the picture of the sound of the places of the picture of the walk of the places of the picture of
			// their own, so how many of them stand there is not known before they stand of the places of the
			// picture of the walk of the places of the picture of the place of the picture of the walk of them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				script: "gsc",
				headerSize: layout.headerSize,
				codeSize: layout.codeSize,
				textSize: layout.textSize,
				lines: layout.index.length,
				footerSize: data.length - layout.footerAt,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		return Readable.from([Buffer.from(unpackGscScript(data), "utf8")]);
	},
});
