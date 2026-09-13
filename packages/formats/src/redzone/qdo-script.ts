// Format reference: GARbro "Legacy/RedZone/ScriptQDO.cs", class `QdoOpener` (a Red-Zone script whose
// body is obfuscated unless a flag byte says it has already been converted). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** The registry signature covers the first four bytes, which read `QDO_`. */
const SIGNATURE = Buffer.from([0x51, 0x44, 0x4f, 0x5f]);
/** `IsScript` compares seven bytes, so the tag is really `QDO_SHO`. */
const TAG = Buffer.from("QDO_SHO", "latin1");
/** Zero means the body has already been converted; anything else means it still needs to be. */
const FLAG_OFFSET = 0x0c;
const SCRIPT_DATA_POS = 0x0e;
const SUBTRACT = 13;

/** `data[i] = (byte)~(data[i] - 13)`, the reference's own `ConvertFrom` step. */
function decode(input: Buffer, offset: number): void {
	for (let i = offset; i < input.length; i += 1) {
		input[i] = ~((input[i] ?? 0) - SUBTRACT) & 0xff;
	}
}

/** The inverse, which is what the reference's `ConvertBack` applies. */
export function encodeQdo(input: Buffer, offset = SCRIPT_DATA_POS): void {
	for (let i = offset; i < input.length; i += 1) {
		input[i] = (~(input[i] ?? 0) + SUBTRACT) & 0xff;
	}
}

async function readTag(source: ByteSource): Promise<Buffer | undefined> {
	if (source.size < BigInt(TAG.length)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, TAG.length));
		if (!head.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
		if (!head.equals(TAG)) return undefined;
		if (source.size <= BigInt(SCRIPT_DATA_POS)) return undefined;
		return head;
	} catch {
		return undefined;
	}
}

export const qdoScriptDescriptor: FormatDescriptor = {
	id: "redzone-qdo-script",
	name: "Red-Zone script file",
	extensions: [],
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
			source: "Legacy/RedZone/ScriptQDO.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const qdoScriptFormat: ArchiveFormat = defineFixedArchive({
	descriptor: qdoScriptDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readTag(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		if (!(await readTag(source)))
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Red-Zone QDO script");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "txt"),
				offset: 0n,
				size: source.size,
				encrypted: true,
				metadata: { type: "script" } as Record<string, unknown>,
			}),
			// The body is deobfuscated in place, so the length does not change.
			sizeKnown: true,
		};
		return {
			entries: [entry],
			metadata: {
				script: "qdo",
				encrypted: true,
				scriptDataOffset: SCRIPT_DATA_POS,
			},
		};
	},
	async openEntry(source: ByteSource) {
		if (!(await readTag(source)))
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Red-Zone QDO script");
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		// `ConvertFrom` only transforms the body when the flag byte says it has not been converted yet,
		// and it clears the flag afterwards, which makes the operation idempotent.
		if (data[FLAG_OFFSET] !== 0) {
			decode(data, SCRIPT_DATA_POS);
			data[FLAG_OFFSET] = 0;
		}
		return Readable.from([data]);
	},
});
