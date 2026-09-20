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
const CLEAR_PER_TEXT = 3;
const TEXT_PER_CLEAR = 4;
/** The name of the file the reference hands out of such an archive. */
const ENTRY_NAME = "data.txt";

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export function hasDsmByteOrderMark(data: Buffer): boolean {
	if (data.length < BYTE_ORDER_MARK.length) return false;
	return data.subarray(0, BYTE_ORDER_MARK.length).equals(BYTE_ORDER_MARK);
}

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
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: { script: "dsm", encrypted: true },
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		return Readable.from([decryptDsm(stored)]);
	},
});
