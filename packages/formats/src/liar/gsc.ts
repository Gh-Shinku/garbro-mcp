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

const HEAD_SIZE = 0x14;
const MOST_HEAD = 0x24;
const CODE_SIZE_AT = 0x08;
const TEXT_INDEX_SIZE_AT = 0x0c;
const TEXT_SIZE_AT = 0x10;
const WORD = 4;
const CP932 = new TextDecoder("shift_jis");

function invalidScript(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

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

export function readGscLayout(data: Buffer): GscLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
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
