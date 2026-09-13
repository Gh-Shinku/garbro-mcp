// Format reference: GARbro "ArcFormats/NScripter/Script.cs", class `NSOpener` (a script resource
// rather than an archive: the file named `nscript.dat` is masked with a single byte key).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** `ConvertFrom` and `ConvertBack` are the same mask, so it is its own inverse. */
const KEY = 0x84;
/** There is no signature: the reference recognises the script by its file name alone. */
const SCRIPT_FILE_NAME = "nscript.dat";

function baseName(sourcePath: string): string {
	return sourcePath.replace(/^.*[/\\]/, "");
}

/** GARbro `NSOpener.IsScript`, which compares the file name (case insensitively). */
function hasScriptName(sourcePath: string): boolean {
	return baseName(sourcePath).toLowerCase() === SCRIPT_FILE_NAME;
}

export const nsOpenerDescriptor: FormatDescriptor = {
	id: "nscripter-script",
	name: "NScripter engine script file",
	extensions: ["dat"],
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
			source: "ArcFormats/NScripter/Script.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const nsOpenerFormat: ArchiveFormat = defineFixedArchive({
	descriptor: nsOpenerDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return source.size > 0n && hasScriptName(sourcePath);
	},
	async read(source: ByteSource, sourcePath: string) {
		if (!hasScriptName(sourcePath))
			throw new GarbroError("INVALID_ARCHIVE", "Invalid NScripter script");
		const entry: FixedEntry = createFixedEntry({
			id: 0,
			path: changeExtension(baseName(sourcePath), "txt"),
			offset: 0n,
			size: source.size,
			encrypted: true,
			metadata: { type: "script" } as Record<string, unknown>,
		});
		return {
			entries: [entry],
			metadata: { script: "nscripter", key: KEY },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		const output: Buffer = Buffer.alloc(data.length);
		for (let i = 0; i < data.length; i += 1) output[i] = (data[i] ?? 0) ^ KEY;
		return Readable.from([output]);
	},
});
