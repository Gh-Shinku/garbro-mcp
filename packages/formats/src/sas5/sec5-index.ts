// Format reference: GARbro "ArcFormats/Sas5/ArcSec5.cs", the walk of the names of the places of the picture
// of the walk of the places of the picture of the engine of the SAS5 kind: `Sec5Opener.LookupIndex`,
// `FindSec5Resr`, `ReadResrSection` and `ReadRes2Section` (with the places of the picture of the walk of the
// places of the picture of the words of the walk of the picture standing of "GameRes/BinaryStream.cs",
// `ReadCString`). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { readFile } from "node:fs/promises";
import { findCompanionFilesByExtension } from "../shared/companion.js";
import { readSec5Sections } from "./sec5.js";

/** The places of the picture of the walk of the places of the picture of the places of the picture of the
 * sound of the walk of them that stand for the places of the picture of the walk of them of the places of the
 * picture of the walk of the places of the picture of the archives of the engine. */
const WAR_KIND = "file-war";
const IAR_KIND = "file-iar";
const RESR_MARK = "RESR";
const RES2_MARK = "RES2";
const COUNT_SIZE = 4;
const LENGTH_SIZE = 4;
/** The places of the picture of the walk of the places of the picture of the picture of the walk of them of
 * the places of the picture of the walk of the places of the picture stand of eight places of the picture. */
const BYTE_RANK = 8;
const STRING_KIND = 0x90;
const STRING_KIND_MASK = 0xf8;
const INTEGER_KIND = 0x80;
const INTEGER_KIND_MASK = 0xf8;
const NUMBER_BITS_MASK = 0xe0;
const LOCATED_PLACES = 0x0f;
const LOCATED_SIGN = 0x10;
const MOST_PLACES = 4;
const TWO_PLACES = 3;
const LIMIT = 1_000_000;

/** The places of the picture of the walk of the places of the picture of a place of the picture of the walk
 * of them of the places of the picture of the walk of the places of the picture of the engine. */
export interface Sec5IndexPlace {
	name: string;
	type: string;
}

/** The places of the picture of the walk of the places of the picture of the name of the place of the picture
 * of the walk of the places of the picture of the engine of their own. */
const CP932 = new TextDecoder("shift_jis");

function kindOf(place: string): string {
	return place.toLowerCase();
}

/** `BinaryStream.ReadCString`: the places of the picture of the walk of the places of the picture of a word
 * that stands for the places of the picture of no places of their own. */
function readCString(
	data: Buffer,
	at: number,
): { value: string; position: number } | undefined {
	if (at > data.length) return undefined;
	let end = at;
	while (end < data.length && data[end] !== 0) end += 1;
	return {
		value: CP932.decode(data.subarray(at, end)),
		// The reference stands the places of the picture of the walk of the places of the picture behind the
		// places of the picture that stand for the places of the picture of no places of their own.
		position: end < data.length ? end + 1 : data.length,
	};
}

/**
 * `Sec5Opener.ReadResrSection`: the places of the picture of the walk of the places of the picture of the
 * places of the picture of the engine of the first kind. Every place of the picture of the walk of them stands
 * of the places of the picture of the walk of the places of the picture of the name of the picture of the walk
 * of it, of the places of the picture of the walk of the places of the picture of the kind of the picture of
 * the walk of it, of the places of the picture of the walk of the places of the picture of the kind of the
 * places of the picture of the walk of them of the places of the picture of the walk of the places of the
 * picture of the engine, and of the places of the picture of the walk of the places of the picture of the
 * place of the picture of the walk of them.
 */
export function readSec5ResrSection(
	data: Buffer,
): Map<string, Map<number, Sec5IndexPlace>> | undefined {
	if (data.length < COUNT_SIZE) return undefined;
	const count = data.readInt32LE(0);
	if (count <= 0 || count > LIMIT) return undefined;
	const map = new Map<string, Map<number, Sec5IndexPlace>>();
	let at = COUNT_SIZE;
	for (let i = 0; i < count; i += 1) {
		const name = readCString(data, at);
		if (!name) return undefined;
		const type = readCString(data, name.position);
		if (!type) return undefined;
		const kind = readCString(data, type.position);
		if (!kind) return undefined;
		if (kind.position + LENGTH_SIZE > data.length) return undefined;
		const length = data.readInt32LE(kind.position);
		const next = kind.position + LENGTH_SIZE + length;
		if (next > data.length) return undefined;
		at = next;
		if (kindOf(kind.value) !== WAR_KIND && kindOf(kind.value) !== IAR_KIND)
			continue;
		const archive = readCString(data, kind.position + LENGTH_SIZE);
		if (!archive) return undefined;
		if (archive.position + LENGTH_SIZE > data.length) return undefined;
		const id = data.readInt32LE(archive.position);
		const base = kindOf(archive.value.replace(/^.*[/\\]/, ""));
		let places = map.get(base);
		if (!places) {
			places = new Map<number, Sec5IndexPlace>();
			map.set(base, places);
		}
		places.set(id, { name: name.value, type: type.value });
	}
	return map.size > 0 ? map : undefined;
}

/** `Res2Reader`: the places of the picture of the walk of the places of the picture of the places of the
 * picture of the engine of the second kind, the places of the picture of the walk of the places of the
 * picture of the words of the walk of the picture standing in the places of the picture of the walk of the
 * places of the picture of their own. */
class Res2Reader {
	private at = 0;

	constructor(
		private readonly data: Buffer,
		private readonly strings: Buffer,
	) {}

	get position(): number {
		return this.at;
	}

	private readByte(): number | undefined {
		if (this.at >= this.data.length) return undefined;
		const value = this.data[this.at] ?? 0;
		this.at += 1;
		return value;
	}

	/** `Res2Reader.ReadNumber`: the places of the picture of the walk of the places of the picture of the
	 * sound of the places of the picture standing of the places of the picture of the walk of the places of
	 * them, of the places of the picture of the walk of the places of the picture of the picture of the walk of
	 * them of the places of the picture of the walk of the places of the picture of the picture of their own
	 * where the places of the picture of the walk of the places of the picture of the word of the walk of them
	 * stand behind the places of the picture of the walk of the places of the picture of the third place of the
	 * picture of the walk of them. */
	readNumber(kind: number): number | undefined {
		const count = (kind & 7) + 1;
		if (count > MOST_PLACES) return undefined;
		let value = 0;
		let rank = 0;
		for (let i = 0; i < count; i += 1) {
			const byte = this.readByte();
			if (byte === undefined) return undefined;
			value |= byte << rank;
			rank += BYTE_RANK;
		}
		if (count <= TWO_PLACES) {
			const sign = value & (1 << (BYTE_RANK * count - 1));
			if (sign !== 0) value -= sign << 1;
		}
		return value;
	}

	/** `Res2Reader.ReadString`: the places of the picture of the walk of the places of the picture of a place
	 * of the picture of the walk of them of the places of the picture of the walk of the places of the picture
	 * of the places of the picture of the engine. */
	readString(): string | undefined {
		const kind = this.readByte();
		if (kind === undefined || (kind & STRING_KIND_MASK) !== STRING_KIND)
			return undefined;
		const offset = this.readNumber(kind);
		if (
			offset === undefined ||
			offset < 0 ||
			offset + LENGTH_SIZE > this.strings.length
		)
			return undefined;
		const length = this.strings.readInt32LE(offset);
		if (length < 0 || offset + LENGTH_SIZE + length > this.strings.length)
			return undefined;
		return CP932.decode(
			this.strings.subarray(
				offset + LENGTH_SIZE,
				offset + LENGTH_SIZE + length,
			),
		);
	}

	/** `Res2Reader.ReadInteger`: the places of the picture of the walk of the places of the picture of the
	 * sound of the places of the picture of the walk of the places of the picture of the word of the walk of
	 * the places of the picture of their own. */
	readInteger(): number | undefined {
		const kind = this.readByte();
		if (kind === undefined) return undefined;
		if ((kind & NUMBER_BITS_MASK) !== 0) {
			if ((kind & INTEGER_KIND_MASK) !== INTEGER_KIND) return undefined;
			return this.readNumber(kind);
		}
		return (kind & LOCATED_PLACES) - (kind & LOCATED_SIGN);
	}

	/** `Res2Reader.SkipObject`: the places of the picture of the walk of the places of the picture of the
	 * places of the picture of the walk of them that stand for the places of the picture of the walk of the
	 * places of the picture of this kind stand of no places of the picture of the walk of them of their own. */
	skipObject(): boolean {
		const kind = this.readByte();
		if (kind === undefined) return false;
		if ((kind & NUMBER_BITS_MASK) === 0) return true;
		return this.readNumber(kind) !== undefined;
	}
}

/** `Sec5Opener.ReadRes2Section`: the places of the picture of the walk of the places of the picture of the
 * places of the picture of the engine of the second kind. */
export function readSec5Res2Section(
	data: Buffer,
): Map<string, Map<number, Sec5IndexPlace>> | undefined {
	if (data.length < COUNT_SIZE) return undefined;
	const tableSize = data.readInt32LE(0);
	if (tableSize < 0) return undefined;
	// The reference stands the places of the picture of the walk of the places of the picture of the places of
	// the picture of the engine of the second kind, the places of the picture of the words of the walk of the
	// picture standing behind the places of the picture of the walk of the places of the picture of the place
	// of the picture of the walk of them.
	const streamAt = COUNT_SIZE + tableSize + COUNT_SIZE;
	if (streamAt > data.length) return undefined;
	const strings = data.subarray(COUNT_SIZE, COUNT_SIZE + tableSize);
	const reader = new Res2Reader(data.subarray(streamAt), strings);
	const count = data.readInt32LE(COUNT_SIZE + tableSize);
	if (count <= 0 || count > LIMIT) return undefined;
	const map = new Map<string, Map<number, Sec5IndexPlace>>();
	for (let i = 0; i < count; i += 1) {
		const name = reader.readString();
		const type = reader.readString();
		reader.readString();
		const parameters = reader.readInteger();
		if (name === undefined || type === undefined || parameters === undefined)
			return undefined;
		if (parameters < 0 || parameters > LIMIT) return undefined;
		let archive: string | undefined;
		let id: number | undefined;
		for (let j = 0; j < parameters; j += 1) {
			const parameter = reader.readString();
			if (parameter === undefined) return undefined;
			if (parameter === "path") archive = reader.readString();
			else if (parameter === "arc-index") id = reader.readInteger();
			else if (!reader.skipObject()) return undefined;
		}
		if (archive === undefined || archive.length === 0 || id === undefined)
			continue;
		const base = kindOf(archive.replace(/^.*[/\\]/, ""));
		let places = map.get(base);
		if (!places) {
			places = new Map<number, Sec5IndexPlace>();
			map.set(base, places);
		}
		places.set(id, { name, type });
	}
	return map.size > 0 ? map : undefined;
}

/** `Sec5Opener.FindSec5Resr`: the places of the picture of the walk of the places of the picture of the
 * names of the places of the picture of the walk of them stand beside the places of the picture of the walk
 * of the places of the picture of the engine of the name that stands beside the places of the picture of the
 * walk of the places of the picture of the picture, or beside the places of the picture of the walk of the
 * places of the picture of the picture above them. */
export async function readSec5Names(
	sourcePath: string,
): Promise<Map<string, Map<number, Sec5IndexPlace>> | undefined> {
	const candidates = await findCompanionFilesByExtension(sourcePath, "sec5");
	for (const candidate of candidates) {
		let stored: Buffer;
		try {
			stored = await readFile(candidate);
		} catch {
			continue;
		}
		const sections = (() => {
			try {
				return readSec5Sections(stored, stored.length);
			} catch {
				return undefined;
			}
		})();
		if (!sections) continue;
		for (const section of sections) {
			const payload = section.encrypted
				? undefined
				: stored.subarray(section.offset, section.offset + section.size);
			if (!payload) continue;
			if (section.name === RESR_MARK) {
				const map = readSec5ResrSection(payload);
				if (map) return map;
			} else if (section.name === RES2_MARK) {
				const map = readSec5Res2Section(payload);
				if (map) return map;
			}
		}
	}
	return undefined;
}

/** `Sec5Opener.LookupIndex`: the places of the picture of the walk of the places of the picture of the names
 * of the places of the picture of the walk of them of the places of the picture of the walk of the places of
 * the picture of an archive of the engine. */
export function lookupSec5Names(
	index: Map<string, Map<number, Sec5IndexPlace>> | undefined,
	archiveName: string,
): Map<number, Sec5IndexPlace> | undefined {
	if (!index) return undefined;
	return index.get(kindOf(archiveName.replace(/^.*[/\\]/, "")));
}

/** The places of the picture of the walk of the places of the picture of the names of the places of the
 * picture of the walk of them of the places of the picture of the walk of the places of the picture of an
 * archive of the engine, standing of no places of the picture of the walk of the places of the picture where
 * the places of the picture of the walk of the places of the picture of the kind of the pictures of the
 * engine stand of no places of the picture of the walk of them. */
export async function readSec5ArchiveNames(
	sourcePath: string,
): Promise<Map<number, Sec5IndexPlace> | undefined> {
	try {
		const index = await readSec5Names(sourcePath);
		return lookupSec5Names(index, sourcePath);
	} catch {
		return undefined;
	}
}
