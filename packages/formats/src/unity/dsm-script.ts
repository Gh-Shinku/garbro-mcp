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

const SCRIPT_NAME = "data.dsm";
const PASSWORD = "pass";
const SALT = Buffer.from("saltは必ず8バイト以上", "utf8");
const ITERATIONS = 1000;
const DIGEST = "sha1";
const KEY_SIZE = 32;
const IV_SIZE = 16;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function invalidScript(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

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

export function hasDsmName(sourcePath: string): boolean {
	const fileName = sourcePath.replace(/^.*[/\\]/, "");
	return fileName.toLowerCase() === SCRIPT_NAME;
}

export function decryptDsm(data: Buffer): Buffer {
	const text = data.toString("utf8").replace(/^\ufeff/, "");
	const cleaned = text.replace(/\s+/g, "");
	if (0 === cleaned.length || !BASE64.test(cleaned)) {
		throw invalidScript(
			"UTAGE script does not hold the places of a ciphered block",
		);
	}
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
	detection: { signatures: [], priority: -1, extensionFallback: true },
	async detect(source: ByteSource, sourcePath?: string) {
		if (!sourcePath || !hasDsmName(sourcePath)) return false;
		if (source.size === 0n) return false;
		try {
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
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: { script: "dsm", encrypted: true },
		};
	},
	async openEntry(source: ByteSource) {
		return Readable.from([await readDsm(source)]);
	},
});
