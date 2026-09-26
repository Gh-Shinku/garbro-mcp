// Port of GARbro "ArcFormats/GsPack/ArcGsPack.cs" (tag "SCW", class GsScriptFormat), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. A script of the GsWin engine, named by one of
// three words of four places at the head of the file.
//
// The reference stands of no walk of the places of such a script at all: `GsScriptFormat` is a
// `GenericScriptFormat` (GameRes/ScriptText.cs), whose `ConvertFrom` hands the places of the file over as
// they stand and whose `Read` and `Write` stand of nothing. This port therefore reads the file, names it a
// script of the engine, and hands the places of it over as they stand - the whole file, of the word at its
// head and all.

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

const BASELINE_COMMIT = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";

/**
 * `GsScriptFormat.Signatures`: the words the head of a script of the engine may stand of - `SCW `, `Scw5`
 * and `Scw4`, of the first of them the `Signature` of the class as well.
 */
export const SCW_SIGNATURES: readonly Buffer[] = [
	Buffer.from("SCW ", "latin1"),
	Buffer.from("Scw5", "latin1"),
	Buffer.from("Scw4", "latin1"),
];

/** `GsScriptFormat`: the head of a file stands of one of the words of the engine. */
export function isScwScript(data: Buffer): boolean {
	if (data.length < 4) return false;
	const head = data.subarray(0, 4);
	return SCW_SIGNATURES.some((signature) => head.equals(signature));
}

export const gsPackScwScriptDescriptor: FormatDescriptor = {
	id: "gs-pack-scw-script",
	name: "GsWin engine script",
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
			source: "ArcFormats/GsPack/ArcGsPack.cs",
			license: "MIT",
			commit: BASELINE_COMMIT,
		},
	],
};

export const gsPackScwScriptFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gsPackScwScriptDescriptor,
	detection: {
		signatures: SCW_SIGNATURES.map((bytes) => ({ bytes })),
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < 4n) return false;
		try {
			return isScwScript(
				Buffer.from(await source.readAt(0n, Number(source.size))),
			);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "txt"),
				offset: 0n,
				size: source.size,
				compressed: false,
				metadata: { type: "script" } as Record<string, unknown>,
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: { script: "scw" },
		};
	},
	async openEntry(source: ByteSource) {
		// `GenericScriptFormat.ConvertFrom`: the places of the file as they stand.
		return Readable.from([
			Buffer.from(await source.readAt(0n, Number(source.size))),
		]);
	},
});
