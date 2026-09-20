// Format reference: GARbro "ArcFormats/Unity/ScriptDSM.cs", classes `DsmConverter` and `DsmDecryptor` (a
// UTAGE scenario of the Unity engine: the places of the script stand as a text of the places of a ciphered
// block, which stands under a key of one's own). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The reference reads a script of this kind only where its name stands as the name `data.dsm`, and hands out
// the places of the script as they stand once they stand in the clear.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The name the reference reads a script of this kind under. */
const SCRIPT_NAME = "data.dsm";
/** The words the reference stands the key of a script of this kind from, and how it stands them. */
const PASSWORD = "pass";
const SALT = Buffer.from("saltは必ず8バイト以上", "utf8");
const ITERATIONS = 1000;
const DIGEST = "sha1";
const KEY_SIZE = 32;
const IV_SIZE = 16;
/** The places of a ciphered block stand as the places of a text of the kind that stands in four places of six
 * and sixty four, which the reference reads as a text of the standard kind first. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function invalidScript(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `DsmDecryptor.GenerateKeyFromPassword`: the key and the places the block of the cipher stands in stand as
 * the places of the walk the standard cipher knows, one and the same walk standing them both. */
export function dsmKeyAndIv(): { key: Buffer; iv: Buffer } {
	const derived = pbkdf2Sync(
		PASSWORD,
		SALT,
		ITERATIONS,
		KEY_SIZE + IV_SIZE,
		DIGEST,
	);
	return {
		key: Buffer.from(derived.subarray(0, KEY_SIZE)),
		iv: Buffer.from(derived.subarray(KEY_SIZE)),
	};
}

/** `DsmConverter.IsScript`: the reference reads a script of this kind only where its name stands as the name
 * of such a script. */
export function hasDsmName(sourcePath: string): boolean {
	const fileName = sourcePath.replace(/^.*[/\\]/, "");
	return fileName.toLowerCase() === SCRIPT_NAME;
}

/**
 * `DsmDecryptor.DecryptString`: the places of the script stand as a text, the text stands as the places of a
 * ciphered block, and those stand under the standard cipher with the key and the places of the block the walk
 * of the reference stands from its own words.
 */
export function decryptDsm(data: Buffer): Buffer {
	const text = data.toString("utf8").replace(/^\ufeff/, "");
	const cleaned = text.replace(/\s+/g, "");
	if (0 === cleaned.length || !BASE64.test(cleaned)) {
		throw invalidScript(
			"UTAGE script does not hold the places of a ciphered block",
		);
	}
	// The places of a text of this kind stand in four places of six and sixty four; the reference reads them
	// the same way.
	const cipher = Buffer.from(cleaned, "base64");
	const { key, iv } = dsmKeyAndIv();
	const decipher = createDecipheriv("aes-256-cbc", key, iv);
	try {
		return Buffer.concat([decipher.update(cipher), decipher.final()]);
	} catch {
		throw invalidScript(
			"UTAGE script does not stand in the clear under its own key",
		);
	}
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readDsm(source: ByteSource): Promise<Buffer> {
	return decryptDsm(await readStored(source));
}

export const unityDsmScriptDescriptor: FormatDescriptor = {
	id: "unity-dsm-script",
	name: "UTAGE Unity engine script file",
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
			source: "ArcFormats/Unity/ScriptDSM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const unityDsmScriptFormat: ArchiveFormat = defineFixedArchive({
	descriptor: unityDsmScriptDescriptor,
	// The reference registers no word of its own: a script of this kind is told by its name alone.
	detection: { signatures: [], priority: -1, extensionFallback: true },
	async detect(source: ByteSource, sourcePath?: string) {
		if (!sourcePath || !hasDsmName(sourcePath)) return false;
		if (source.size === 0n) return false;
		try {
			// The reference claims the file by its name alone; this port also asks that the places of the
			// script stand in the clear under the key of the reference, so a file of that name that holds
			// something else is left to the kinds that read it.
			await readDsm(source);
			return true;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		await readDsm(source);
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
			// The places of the script stand as a text of its own, so how many of them stand there is not
			// known before the text stands in the clear.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: { script: "dsm", encrypted: true },
		};
	},
	async openEntry(source: ByteSource) {
		// The places of the script stand as they stand once they stand in the clear.
		return Readable.from([await readDsm(source)]);
	},
});
