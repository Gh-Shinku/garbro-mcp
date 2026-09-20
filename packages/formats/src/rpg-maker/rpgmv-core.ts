// Format reference: GARbro "Experimental/RPGMaker/ImageRPGMV.cs", class `RpgmvDecryptor`, which the pictures
// and the sounds of the engine both stand under. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** The word every file of these kinds stands behind. */
export const RPGMV_SIGNATURE: Buffer = Buffer.from("RPGMV", "latin1");
/** The word stands in the first five places, and the head of the file stands in the twenty places behind
 * them. */
export const RPGMV_HEADER_SIZE = 0x14;
export const RPGMV_KEY_FIELD = 0x10;
export const RPGMV_KEY_SIZE = 16;
export const RPGMV_PLAIN_OFFSET = 0x20;
export const RPGMV_SYSTEM_PATHS = [
	"../../data/System.json",
	"../../../www/data/System.json",
	"../../../data/System.json",
	"../../../../data/System.json",
	"../data/System.json",
	"data/System.json",
];

export function parseRpgmvKey(hex: string): Buffer | undefined {
	if ((hex.length & 1) !== 0) return undefined;
	const key: Buffer = Buffer.alloc(hex.length / 2, 0x00);
	for (let at = 0; at < key.length; at += 1) {
		const high = hexToPlace(hex[at * 2] ?? "");
		const low = hexToPlace(hex[at * 2 + 1] ?? "");
		if (high < 0 || low < 0) return undefined;
		key[at] = (high << 4) | low;
	}
	return key;
}

function hexToPlace(word: string): number {
	if (word >= "0" && word <= "9") return word.charCodeAt(0) - 0x30;
	const upper = word.toUpperCase();
	if (upper >= "A" && upper <= "F") return upper.charCodeAt(0) - 0x41 + 10;
	return -1;
}

export function parseRpgmvSystem(system: string): Buffer | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(system);
	} catch {
		return undefined;
	}
	if (parsed === null || typeof parsed !== "object") return undefined;
	const key = (parsed as Record<string, unknown>).encryptionKey;
	if (typeof key !== "string") return undefined;
	return parseRpgmvKey(key);
}

export async function findRpgmvKey(
	sourcePath: string,
): Promise<Buffer | undefined> {
	for (const name of RPGMV_SYSTEM_PATHS) {
		try {
			const system = await readFile(resolve(dirname(sourcePath), name), {
				encoding: "utf8",
			});
			const key = parseRpgmvSystem(system);
			if (key) return key;
		} catch {
			// A place the words of the engine do not stand at stands as no key of its own.
		}
	}
	return undefined;
}

export function decryptRpgmvStream(stored: Buffer, key: Buffer): Buffer {
	const head = Buffer.from(
		stored.subarray(RPGMV_KEY_FIELD, RPGMV_KEY_FIELD + key.length),
	);
	for (let at = 0; at < key.length; at += 1) {
		head[at] = (head[at] ?? 0) ^ (key[at] ?? 0);
	}
	return Buffer.concat([head, stored.subarray(RPGMV_PLAIN_OFFSET)]);
}

export function decryptRpgmvHead(
	stored: Buffer,
	key: Buffer,
): Buffer | undefined {
	if (stored.length < RPGMV_HEADER_SIZE) return undefined;
	const head = Buffer.from(
		stored.subarray(RPGMV_KEY_FIELD, RPGMV_KEY_FIELD + key.length),
	);
	for (let at = 0; at < key.length; at += 1) {
		head[at] = (head[at] ?? 0) ^ (key[at] ?? 0);
	}
	return head;
}

export async function readRpgmvFile(
	stored: Buffer,
	sourcePath: string,
	word: Buffer,
): Promise<{ key: Buffer; body: Buffer } | undefined> {
	if (stored.length < RPGMV_HEADER_SIZE) return undefined;
	if ((stored[4] ?? 0) !== 0x56) return undefined;
	const key = await findRpgmvKey(sourcePath);
	if (!key) return undefined;
	const head = decryptRpgmvHead(stored, key);
	if (undefined === head) return undefined;
	if (!head.subarray(0, word.length).equals(word)) return undefined;
	return { key, body: decryptRpgmvStream(stored, key) };
}
