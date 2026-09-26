// Port of GARbro "ArcFormats/Emote/ArcPSB.cs" (classes `PsbOpener` and `PsbReader`), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. The container of the PSB archives of the Emote
// engine: a head that names six tables, and behind them the objects of the file - dictionaries, lists,
// integers, strings and chunks - which stand of a place of the table of the objects of the file.
//
// This file is the **first stage** of the port: the head, the tables of the objects, the two arrays of the
// table of the names (the walk the reference reads a name of an object out of, `GetOffset` and `ReadNames`),
// the search of a key within a dictionary (`GetKey`), and the numbers and chunks a table of objects holds.
// What stands behind it - the strings, the lists and the dictionaries themselves, the cipher of the head and
// the pictures of the archive - stands in the stages behind this one.

import { GarbroError } from "@garbro-mcp/core";

const BASELINE_COMMIT = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";

/** The places of the file of the head of an archive of the engine, of the kind of the file. */
const HEAD_START = 4;
const HEAD_SIZE_OLD = 0x20;
const HEAD_SIZE_NEW = 0x30;
/** The least place of the file a table of the engine may stand of. */
const LEAST_TABLE = 0x28;
/** The place of the file of the head of a dictionary of the engine. */
const DICT_TYPE = 0x21;

/** The table of the objects of the file, of a place within it. */
export interface PsbArray {
	/** The count of the places of the file of the whole of the table, of its head and its objects. */
	arraySize: number;
	count: number;
	elemSize: number;
	dataOffset: number;
}

/** The head of an archive of the engine: the places of its tables, and the place of its own object. */
export interface PsbHeader {
	version: number;
	flags: number;
	names: number;
	strings: number;
	stringsData: number;
	chunkOffsets: number;
	chunkLengths: number;
	chunkData: number;
	root: number;
	extraOffsets?: number;
	extraLengths?: number;
	extraData?: number;
}

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `PsbReader.ReadHeader`: the head of an archive of the engine, of the places of the six tables of it. A
 * head whose places stand outside the file, and a head whose own object stands of no dictionary, stand
 * refused. The cipher of the head stands in the stage behind this one, so a head that names one stands
 * refused as well.
 */
export function readPsbHeader(
	data: Buffer,
	encrypted: boolean,
): PsbHeader | undefined {
	if (data.length < HEAD_START + HEAD_SIZE_OLD) return undefined;
	const version = data.readUInt16LE(HEAD_START);
	let flags = data.readUInt16LE(HEAD_START + 2);
	if (encrypted && version < 3) flags = 2;
	if (0 !== (flags & 1)) return undefined;
	const headSize = version > 3 ? HEAD_SIZE_NEW : HEAD_SIZE_OLD;
	if (data.length < HEAD_START + headSize) return undefined;
	const header = data.subarray(HEAD_START + 4, HEAD_START + 4 + headSize);
	const header4 = (at: number): number => header.readInt32LE(at);
	const parsed: PsbHeader = {
		version,
		flags,
		names: header4(0x04),
		strings: header4(0x08),
		stringsData: header4(0x0c),
		chunkOffsets: header4(0x10),
		chunkLengths: header4(0x14),
		chunkData: header4(0x18),
		root: header4(0x1c),
	};
	if (version > 3) {
		parsed.extraOffsets = header4(0x24);
		parsed.extraLengths = header4(0x28);
		parsed.extraData = header4(0x2c);
	}
	const tables = [
		parsed.names,
		parsed.strings,
		parsed.stringsData,
		parsed.chunkOffsets,
		parsed.chunkLengths,
		parsed.chunkData,
		parsed.root,
	];
	for (const table of tables) {
		if (table < LEAST_TABLE || table > data.length) return undefined;
	}
	for (const table of [
		parsed.names,
		parsed.strings,
		parsed.stringsData,
		parsed.chunkOffsets,
		parsed.chunkLengths,
		parsed.root,
	]) {
		if (table >= parsed.chunkData) return undefined;
	}
	return parsed;
}

/**
 * `PsbReader`: the objects of an archive of the engine, of the places of the file its head names. The places
 * of the file stand of the objects themselves: the place of the file of an object stands of a place within
 * the places of the tables alone, and the head of the file stands of the count of the places of the tables.
 */
export class PsbReader {
	readonly #data: Buffer;
	readonly #header: PsbHeader;

	private constructor(data: Buffer, header: PsbHeader) {
		// The reference stands of a run of the places of the file of the count its head names, of the
		// places of the file of the head itself standing at nought behind it.
		this.#data = Buffer.alloc(header.chunkData, 0x00);
		data.copy(this.#data, 0, 0, Math.min(data.length, header.chunkData));
		this.#header = header;
	}

	/** `PsbReader.Parse`, of a file of no cipher: the head alone, and the root object of a dictionary. */
	static parse(data: Buffer, encrypted = false): PsbReader | undefined {
		const header = readPsbHeader(data, encrypted);
		if (!header) return undefined;
		if (header.version < 2) return undefined;
		const reader = new PsbReader(data, header);
		if (DICT_TYPE !== reader.#byte(header.root)) return undefined;
		return reader;
	}

	get header(): PsbHeader {
		return this.#header;
	}

	#byte(at: number): number {
		return this.#data[at] ?? 0;
	}

	/**
	 * `PsbReader.GetArray`: a table of the objects of the file. The kind of the head of a table stands of
	 * the count of the objects of it, and the kind of the place of the file in front of its first object of
	 * the count of the places of an object.
	 */
	array(at: number): PsbArray {
		const dataOffset = this.#byte(at) - 10;
		if (dataOffset < 1 || at + dataOffset - 1 >= this.#data.length) {
			throw invalidArchive("The table of the engine stands of no kind");
		}
		const count = this.integer(at, 0x0c);
		const elemSize = this.#byte(at + dataOffset - 1) - 12;
		if (elemSize < 1 || elemSize > 4) {
			throw invalidArchive("Invalid PSB array structure");
		}
		const start = at + dataOffset;
		return {
			count,
			elemSize,
			dataOffset: start,
			arraySize: count * elemSize + dataOffset,
		};
	}

	/** `PsbReader.GetArrayElem`: one object of a table of the objects of the file. */
	element(table: PsbArray, index: number): number {
		const at = table.dataOffset + index * table.elemSize;
		switch (table.elemSize) {
			case 1:
				return this.#byte(at);
			case 2:
				return this.#data.readUInt16LE(at);
			case 3:
				return this.#data.readUInt16LE(at) | (this.#byte(at + 2) << 16);
			default:
				return this.#data.readInt32LE(at);
		}
	}

	/** `PsbReader.GetInteger`: a count of the file, of the kind of the head of the object. */
	integer(at: number, base: number): number {
		switch (this.#byte(at) - base) {
			case 1:
				return this.#byte(at + 1);
			case 2:
				return this.#data.readUInt16LE(at + 1);
			case 3:
				return this.#data.readUInt16LE(at + 1) | (this.#byte(at + 3) << 16);
			case 4:
				return this.#data.readInt32LE(at + 1);
			default:
				return 0;
		}
	}

	/**
	 * `PsbReader.GetLong`: a count of the file of more than four places. The four kinds of the head of such
	 * a count stand of a run of four places of the file, of the places behind it standing of the places of
	 * the count above those four, of one, of two or of three places of the file.
	 */
	long(at: number): number {
		const low = this.#data.readUInt32LE(at + 1);
		switch (this.#byte(at)) {
			case 0x09:
				return low + ((this.#byte(at + 5) << 24) >> 24) * 0x100000000;
			case 0x0a:
				return low + this.#data.readInt16LE(at + 5) * 0x100000000;
			case 0x0b:
				return (
					low +
					this.#data.readUInt16LE(at + 5) * 0x100000000 +
					((this.#byte(at + 6) << 24) >> 24) * 0x1000000000000
				);
			case 0x0c:
				return Number(this.#data.readBigInt64LE(at + 1));
			default:
				return 0;
		}
	}

	/**
	 * `PsbReader.GetOffset`: the place of the file of the object a name stands of, out of the two tables of
	 * the names of the file. The first table names, for every place of the second, the place the walk of a
	 * name stands at; the second names the place of the file a walk of a name stood at behind the place it
	 * names. A place of the file that stands beyond the first table, or whose place behind it stands of
	 * another, ends the walk.
	 */
	offsetOf(name: string): number | undefined {
		const names = this.array(this.#header.names);
		const parents = this.array(this.#header.names + names.arraySize);
		let at = 0;
		for (let index = 0; ; index += 1) {
			const symbol = index < name.length ? name.charCodeAt(index) : 0;
			const previous = at;
			at = symbol + this.element(names, at);
			if (at >= names.count || at >= parents.count) return undefined;
			if (this.element(parents, at) !== previous) return undefined;
			if (index >= name.length) return this.element(names, at);
		}
	}

	/**
	 * `PsbReader.ReadNames`: every name of the file, of the place of the file of the object it stands of. The
	 * walk stands of the two tables of the names as well, of a run of the places of the file the count of
	 * the objects of a table stands of, and the count stands of the places of a name of one place of the
	 * file.
	 */
	nameMap(): Map<number, string> {
		const names = this.array(this.#header.names);
		const parents = this.array(this.#header.names + names.arraySize);
		const found = new Map<number, string>();
		const frontier: { at: number; prefix: string }[] = [{ at: 0, prefix: "" }];
		while (frontier.length > 0) {
			const node = frontier.shift();
			if (!node) break;
			const first = this.element(names, node.at);
			for (let symbol = 0; symbol < 256; symbol += 1) {
				const at = symbol + first;
				if (at >= parents.count) break;
				if (this.element(parents, at) !== node.at) continue;
				const prefix =
					0 === symbol
						? node.prefix
						: node.prefix + String.fromCharCode(symbol);
				if (0 === symbol) {
					found.set(this.element(names, at), prefix);
				} else {
					frontier.push({ at, prefix });
				}
			}
		}
		return found;
	}

	/**
	 * `PsbReader.GetKey`: the place of the file of the object a name stands of within a dictionary of the
	 * file. The names of a dictionary stand in a table of their own, sorted, and the walk stands of the
	 * table of the places of the objects of the dictionary behind it.
	 */
	key(name: string, dictAt: number): number | undefined {
		const wanted = this.offsetOf(name);
		if (undefined === wanted) return undefined;
		const keys = this.array(dictAt + 1);
		if (0 === keys.count) return undefined;
		let lower = 0;
		let upper = keys.count;
		let index = 0;
		while (lower < upper) {
			index = (upper + lower) >> 1;
			const key = this.element(keys, index);
			if (key === wanted) break;
			if (key >= wanted) upper = (upper + lower) >> 1;
			else lower = index + 1;
		}
		if (lower >= upper) return undefined;
		const values = this.array(dictAt + 1 + keys.arraySize);
		const dataOffset = this.element(values, index);
		return dictAt + 1 + keys.arraySize + values.arraySize + dataOffset;
	}

	/** `PsbReader.GetObject` of the numbers and of the objects of no type of their own. */
	scalar(at: number): boolean | number | null | undefined {
		switch (this.#byte(at)) {
			case 1:
				return null;
			case 2:
				return true;
			case 3:
				return false;
			case 4:
			case 5:
			case 6:
			case 7:
			case 8:
				return this.integer(at, 4);
			case 9:
			case 0x0a:
			case 0x0b:
			case 0x0c:
				return this.long(at);
			default:
				return undefined;
		}
	}
}

export const PSB_READER_STAGE = {
	baselineCommit: BASELINE_COMMIT,
	reference: "ArcFormats/Emote/ArcPSB.cs",
	carried: ["head", "tables", "names", "key search", "numbers"],
	notCarried: [
		"the cipher of the head",
		"strings",
		"lists",
		"dictionaries",
		"chunks",
		"pictures",
	],
} as const;
