// The password of a password-encrypted archive of the Entis GLS engine, from GARbro
// "ArcFormats/Entis/ArcNOA.cs" — `NoaOpener.GetArcPassword`, `NoaOpener.ExtractNoaPassword` and
// `NoaOpener.XmlFindArchiveKey` — at GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The reference takes a password from one of three places: a table of game keys that its own settings carry,
// which stands empty in the tree; a pass phrase the user keeps in the settings; and, when neither is there, a
// resource of a neighbouring executable. Only the last of the three can be read here, and this file reads it:
// the engine puts an XML document into a resource named `IDR_COTOMI` of the executable of the game, and the
// document holds one entry for every archive of that game, naming the archive and the password of it.
//
// The reference asks Windows for the resource (`ExeFile.ResourceAccessor`, which is `LoadLibraryEx` and
// `FindResource`), so the walk over the resource tree of the executable stands in
// `packages/formats/src/shared/exe.ts` and is written from the format of a portable executable rather than
// ported. The reference asks for the pair `("IDR_COTOMI", "#10")`, and the second of the two is the kind of
// the resource as its own `ResourceNameToString` writes a numbered one; Windows reads such a string as a name
// and finds nothing, which this reader corrects by reading a `#` and a number as the number.

import { ErisaNemesisDecodeContext } from "@garbro-mcp/codecs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { findExecutableResource } from "../shared/exe.js";

/** The name and the kind of the resource the engine keeps its keys in. */
export const NOA_KEY_RESOURCE = { name: "IDR_COTOMI", type: "#10" };

/** The most bytes one decoded resource may hold, and the most bytes one executable may be. */
const KEY_LIMIT = 0x100000;
const EXECUTABLE_LIMIT = 0x4000000;

/** The parts of an XML tag that names an archive and its password. */
const ARCHIVE_TAG = /<archive\b[^>]*>/gi;
const PATH_ATTRIBUTE = /\bpath\s*=\s*"([^"]*)"/i;
const KEY_ATTRIBUTE = /\bkey\s*=\s*"([^"]*)"/i;

/** The file name of a path, which is what the reference compares an entry of the document against. */
function fileNameOf(path: string): string {
	return path.replace(/^.*[/\\]/, "");
}

/**
 * `XmlFindArchiveKey`: the password of one archive out of the document of the engine. The reference walks the
 * nodes named `archive` that carry both a path and a key and compares the path against the file name of the
 * archive, without its case; this reader scans the tags of the document for the same pair of attributes.
 */
export function findNoaKey(
	document: string,
	archiveName: string,
): string | undefined {
	const wanted = fileNameOf(archiveName).toLowerCase();
	for (const [tag] of document.matchAll(ARCHIVE_TAG)) {
		const path = PATH_ATTRIBUTE.exec(tag)?.[1];
		const key = KEY_ATTRIBUTE.exec(tag)?.[1];
		if (undefined === path || undefined === key) continue;
		if (fileNameOf(path).toLowerCase() === wanted) return key;
	}
	return undefined;
}

/** The document the engine keeps in its resource: a Nemesis stream, and the bytes as they stand. */
function readKeyResource(resource: Buffer): Buffer | undefined {
	if (0 === resource.length) return undefined;
	try {
		const context = new ErisaNemesisDecodeContext();
		context.attachInputFile(resource);
		context.prepareToDecodeErisaNCode();
		const output = new Uint8Array(KEY_LIMIT);
		const written = context.decodeNemesisCodeBytes(output, 0, KEY_LIMIT);
		if (written > 0) return Buffer.from(output.subarray(0, written));
	} catch {
		// A resource that is no Nemesis stream is read as it stands behind this.
	}
	return resource;
}

/**
 * `ExtractNoaPassword` for one executable: the password of the named archive out of the `IDR_COTOMI` resource
 * of the file, or undefined when the file carries no such resource or no entry for the archive. The reference
 * reads the resource as a Nemesis stream; a resource that is no such stream is read as it stands here, which
 * the reference would turn into a failure of its own document reader.
 */
export function readNoaKeyResource(
	data: Buffer,
	archiveName: string,
): string | undefined {
	const resource = findExecutableResource(data, NOA_KEY_RESOURCE);
	if (!resource) return undefined;
	const document = readKeyResource(resource);
	if (!document) return undefined;
	return findNoaKey(document.toString("utf8"), archiveName);
}

/** The executables of a directory, sorted, with the ones too long to hold a resource left out. */
async function listExecutables(directory: string): Promise<string[]> {
	try {
		const names = await readdir(directory);
		return names
			.filter((name) => name.toLowerCase().endsWith(".exe"))
			.sort()
			.map((name) => resolve(directory, name));
	} catch {
		return [];
	}
}

/**
 * `GetArcPassword` through `ExtractNoaPassword`: the password of an archive out of the executables of the
 * directory above it and of its own directory, in that order, which is the order the reference walks them in.
 * The two directories stand for the same one when the archive names none, and are walked once there.
 */
export async function extractNoaPassword(
	sourcePath: string,
	archiveName: string,
): Promise<string | undefined> {
	const directory = dirname(sourcePath);
	const above = dirname(directory);
	const candidates = [
		...(above === directory ? [] : await listExecutables(above)),
		...(await listExecutables(directory)),
	];
	for (const candidate of candidates) {
		let data: Buffer;
		try {
			data = await readFile(candidate);
		} catch {
			continue;
		}
		if (data.length > EXECUTABLE_LIMIT) continue;
		const key = readNoaKeyResource(data, archiveName);
		if (undefined !== key) return key;
	}
	return undefined;
}
