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

const SCR_MARK = Buffer.from("SCR\0", "latin1");
const HEAD_SIZE = 0x0c;
const RECORD_SIZE = 0x0c;
const WORD = 4;
const CP932 = new TextDecoder("shift_jis");

function invalidScript(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export interface ScrLine {
	id: number;
	text: string;
}

export interface ScrLayout {
	type: number;
	lines: ScrLine[];
}

export function readScrLayout(data: Buffer): ScrLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, SCR_MARK.length).equals(SCR_MARK)) return undefined;
	const type = data.readUInt32LE(WORD);
	const count = data.readUInt32LE(2 * WORD);
	if (HEAD_SIZE + count * RECORD_SIZE > data.length) return undefined;
	const lines: ScrLine[] = [];
	for (let i = 0; i < count; i += 1) {
		const at = HEAD_SIZE + i * RECORD_SIZE;
		const offset = data.readUInt32LE(at);
		const size = data.readInt32LE(at + WORD);
		const id = data.readUInt32LE(at + 2 * WORD);
		if (size < 0 || offset + size > data.length) return undefined;
		lines.push({
			id,
			text: CP932.decode(data.subarray(offset, offset + size)),
		});
	}
	return { type, lines };
}

export function unpackScrScript(data: Buffer): string {
	const layout = readScrLayout(data);
	if (!layout) throw invalidScript("Not a script of this kind");
	return `${layout.lines.map((line) => line.text).join("\n")}\n`;
}

export const scrScriptDescriptor: FormatDescriptor = {
	id: "amaterasu-scr-script",
	name: "Amaterasu game engine script format",
	extensions: ["scr"],
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
			source: "ArcFormats/Amaterasu/ArcAMI.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const scrScriptFormat: ArchiveFormat = defineFixedArchive({
	descriptor: scrScriptDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("SCR\0", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, Number(source.size)));
			return readScrLayout(data) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readScrLayout(data);
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
				script: "scr/ami",
				scriptType: layout.type,
				lines: layout.lines.length,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		return Readable.from([Buffer.from(unpackScrScript(data), "utf8")]);
	},
});
