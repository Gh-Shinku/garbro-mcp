// Format reference: GARbro "ArcFormats/Ice/ScriptISD.cs", class `IsdScript` (tag `ISD`, a TPW compressed
// binary script). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { unpackTpw } from "../ankh/grp-unpack.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `TPW` followed by a version byte, which is the reference's `Signature` of `0x01575054`. */
const SIGNATURE = Buffer.from([0x54, 0x50, 0x57, 0x01]);
const HEADER_SIZE = 8;
const UNPACKED_SIZE_OFFSET = 4;
/** `GrpOpener.UnpackTpw` seeks here before reading its first control stream word. */
const PAYLOAD_OFFSET = HEADER_SIZE;
/** Guards against a hostile header asking for an unreasonable allocation. */
const MAX_OUTPUT = 0x4000000;

interface IsdLayout {
	unpackedSize: number;
	payloadOffset: number;
	payloadSize: number;
}

/**
 * The reference's `IsScript` only compares the signature and its `ConvertFrom` reads the unpacked size
 * from the second word, so listing needs no more than this.
 */
async function readLayout(source: ByteSource): Promise<IsdLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		const unpackedSize = header.readInt32LE(UNPACKED_SIZE_OFFSET);
		if (unpackedSize <= 0 || unpackedSize > MAX_OUTPUT) return undefined;
		return {
			unpackedSize,
			payloadOffset: PAYLOAD_OFFSET,
			payloadSize: Number(source.size) - PAYLOAD_OFFSET,
		};
	} catch {
		return undefined;
	}
}

export const isdScriptDescriptor: FormatDescriptor = {
	id: "ice-isd-script",
	name: "Ice Soft binary script",
	extensions: ["isd"],
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
			source: "ArcFormats/Ice/ScriptISD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const isdScriptFormat: ArchiveFormat = defineFixedArchive({
	descriptor: isdScriptDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ice ISD script");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				// The reference hands the unpacked bytes through unchanged, and they are binary.
				path: changeExtension(fileName, "bin"),
				offset: BigInt(layout.payloadOffset),
				size: BigInt(layout.payloadSize),
				compressed: true,
				metadata: {
					type: "script",
					unpackedSize: layout.unpackedSize,
				} as Record<string, unknown>,
			}),
			// The payload is compressed, so the stored length is not the extracted one.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				script: "isd",
				compression: "tpw",
				unpackedSize: layout.unpackedSize,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ice ISD script");
		// The TPW decoder seeks to offset 8 itself, so it is handed the whole file.
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const output = Buffer.alloc(layout.unpackedSize);
		try {
			unpackTpw(stored, output);
		} catch {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ice ISD script");
		}
		return Readable.from([output]);
	},
});
