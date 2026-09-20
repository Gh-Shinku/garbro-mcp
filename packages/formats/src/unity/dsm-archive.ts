// Format reference: GARbro "ArcFormats/Unity/ArcDSM.cs", class `DsmOpener` (the archive the UTAGE scenario of
// the Unity engine stands as: one file of the name `data.dsm`, whose places stand as the places of a ciphered
// block). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The reference names the same file twice, once as an archive and once as a script; both hand out the same
// places, so this port stands over the same walk as the script of this engine.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { decryptDsm, hasDsmName } from "./dsm-script.js";

/** The places a text of the kind the scenario stands as begin with, which the head of the file holds where
 * the file stands as an archive. */
const BYTE_ORDER_MARK = Buffer.from([0xef, 0xbb, 0xbf]);
/** How many places of the clear stand for every four places of the text the scenario stands as. */
const CLEAR_PER_TEXT = 3;
const TEXT_PER_CLEAR = 4;
/** The name of the file the reference hands out of such an archive. */
const ENTRY_NAME = "data.txt";

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `DsmOpener.TryOpen`: the reference reads a file of this kind only where its name stands as the name of such
 * a file and where the places of the file begin with the places a text of the kind stands with. */
export function hasDsmByteOrderMark(data: Buffer): boolean {
	if (data.length < BYTE_ORDER_MARK.length) return false;
	return data.subarray(0, BYTE_ORDER_MARK.length).equals(BYTE_ORDER_MARK);
}

/** How many places the reference stands for a file of this kind: how many places the text stands in, three to
 * every four of them, which stands over the places of the clear. */
export function dsmClearSize(fileLength: number): number {
	return Math.floor(fileLength / TEXT_PER_CLEAR) * CLEAR_PER_TEXT;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const unityDsmArchiveDescriptor: FormatDescriptor = {
	id: "unity-dsm-archive",
	name: "Unity engine scenario archive",
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
			source: "ArcFormats/Unity/ArcDSM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const unityDsmArchiveFormat: ArchiveFormat = defineFixedArchive({
	descriptor: unityDsmArchiveDescriptor,
	// The reference registers no word of its own, so an archive of this kind is tried after every kind that is
	// told by a word of its own; where its places stand as a text of the kind the name stands for, it is tried
	// before the kind that reads the same file as a script of its own.
	detection: { signatures: [], priority: 10, extensionFallback: true },
	async detect(source: ByteSource, sourcePath?: string) {
		if (!sourcePath || !hasDsmName(sourcePath)) return false;
		if (source.size < BigInt(BYTE_ORDER_MARK.length)) return false;
		try {
			const head = Buffer.from(await source.readAt(0n, 3));
			return hasDsmByteOrderMark(head);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		if (!hasDsmName(sourcePath) || !hasDsmByteOrderMark(stored)) {
			throw invalidArchive("Not a scenario of the Unity engine");
		}
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: ENTRY_NAME,
				offset: 0n,
				size: BigInt(dsmClearSize(stored.length)),
				encrypted: true,
				metadata: { type: "script" } as Record<string, unknown>,
			}),
			// The reference stands how many places the file holds over the places of the text the scenario
			// stands as, so how many places the clear holds may stand a little short of what it names.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: { script: "dsm", encrypted: true },
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		// The places of the scenario stand as the places of the text it holds once they stand in the clear.
		return Readable.from([decryptDsm(stored)]);
	},
});
