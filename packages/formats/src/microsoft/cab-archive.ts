// Port of GARbro "Experimental/Cabinet/ArcCAB.cs" (tag "CAB", class `CabOpener`), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The reference carries no walk of a cabinet of its own: it hands the whole of it to
// `Microsoft.Deployment.Compression.Cab`, the managed cabinet reader of the WiX deployment tools, which it
// does not carry in the tree either. What stands here is therefore a reader of the cabinet format itself
// (the format Microsoft documents as the "Microsoft Cabinet Format"), written the way this project writes
// the other formats the reference leaves to a library of its platform:
//
//  * a cabinet opens with a head (`MSCF`) that names the count of its folders and of its files, where the
//    file table lies and how long the cabinet is. A cabinet that continues another one carries the names of
//    the cabinets on either side of it behind the head, and one that reserves room for another program
//    carries the length of that room;
//  * every folder of the head names the place of its first block of data, how many blocks it holds and how
//    they are compressed: not at all, the deflate of MSZIP, or one of the two kinds this reader does not
//    read (Quantum and LZX);
//  * every file names its length before it is unfolded, the place of its bytes inside its folder, the number
//    of its folder, and its name, which stands behind the record;
//  * the blocks of a folder follow the head: each names the length of its compressed bytes, the length of
//    the bytes they unfold to, and a check word. A block of MSZIP opens with the letters `CK` and holds one
//    whole deflate stream whose window stands at the bytes the blocks before it unfolded to, so the last
//    thirty two thousand of them are handed to the reader of the block behind it.
//
// A file whose length reads `0xffffffff` continues into the cabinet behind its own; the part this cabinet
// holds is what is handed over here, and the note of this format says so. A folder whose blocks are of a
// kind this reader does not read is still listed, and is turned away when it is extracted, which is how this
// project treats the other formats whose payload it does not unfold. The reference names the type of an
// entry from its catalogue by the name of the file; the catalogue is not carried here, so no type is named,
// as with the other archives of this project.

import {
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { inflateRawSync } from "node:zlib";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	isSaneCount,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("MSCF", "latin1");
const HEAD_SIZE = 36;
const FOLDER_RECORD_SIZE = 8;
const FILE_RECORD_SIZE = 16;
const BLOCK_HEAD_SIZE = 8;
/** The letters a block of MSZIP opens with, before its own deflate stream. */
const MSZIP_SIGNATURE = Buffer.from("CK", "latin1");
/** The kinds of compression a folder may name. */
const COMPRESSION_NONE = 0;
const COMPRESSION_MSZIP = 1;
/** The window a block of MSZIP may reach back into: the bytes the blocks before it unfolded to. */
const MSZIP_WINDOW = 0x8000;
/** The head flags that name the cabinets on either side of this one and the room reserved for another program. */
const FLAG_PREVIOUS = 0x0001;
const FLAG_NEXT = 0x0002;
const FLAG_RESERVE = 0x0004;
/** A cabinet with more folders or files than this is turned away rather than walked forever. */
const COUNT_LIMIT = 0x10000;
/** The length that says a file continues into the cabinet behind this one. */
const CONTINUED = 0xffffffff;

export interface CabLayout {
	/** The length the head names for the whole cabinet. */
	length: number;
	versionMajor: number;
	versionMinor: number;
	/** The number of this cabinet within the set it belongs to, nought for the first. */
	cabinet: number;
	folders: {
		start: number;
		blocks: number;
		/** The kind of compression: nought for none, one for MSZIP, two for Quantum, three for LZX. */
		compression: number;
		/**
		 * The parameter the word of the folder carries in its high byte. It reads nought for MSZIP in the
		 * cabinets checked here and fifteen and twenty one for the two cabinets of LZX of Windows that were
		 * checked, which stands with the window of that compression; this reader does not use it.
		 */
		parameter: number;
	}[];
	files: {
		/** The length of the file before it is unfolded, or `0xffffffff` for one that continues. */
		length: number;
		/** Where the bytes of the file stand inside the folder that holds them. */
		offset: number;
		folder: number;
		name: string;
	}[];
}

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupportedArchive(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

/** Reads a name that ends at its own zero byte, and the place behind it. */
function readCString(data: Buffer, at: number): { text: string; next: number } {
	const end = data.indexOf(0, at);
	if (end < 0) return { text: data.toString("latin1", at), next: data.length };
	return { text: data.toString("latin1", at, end), next: end + 1 };
}

/**
 * The head of a cabinet and the two tables behind it, or undefined when the stream is no cabinet or its
 * tables stand outside it or beyond reason. The reference leaves all of this to the WiX library and reports
 * no offsets at all — every entry of it stands at nought — so nothing here is checked against a walk of the
 * reference.
 */
export function readCabLayout(data: Buffer): CabLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const length = data.readUInt32LE(8);
	const filesAt = data.readUInt32LE(16);
	const versionMinor = data[24] ?? 0;
	const versionMajor = data[25] ?? 0;
	const folderCount = data.readUInt16LE(26);
	const fileCount = data.readUInt16LE(28);
	const flags = data.readUInt16LE(30);
	const cabinet = data.readUInt16LE(34);
	if (!isSaneCount(folderCount) || !isSaneCount(fileCount)) return undefined;
	if (folderCount > COUNT_LIMIT || fileCount > COUNT_LIMIT) return undefined;
	// The room another program reserved, and the names of the cabinets on either side of this one, stand
	// between the head and the table of folders.
	let at = HEAD_SIZE;
	if (0 !== (flags & FLAG_RESERVE)) {
		if (at + 4 > data.length) return undefined;
		const reserved = data.readUInt16LE(at);
		at += 4 + reserved;
	}
	if (0 !== (flags & FLAG_PREVIOUS)) {
		at = readCString(data, at).next;
		at = readCString(data, at).next;
	}
	if (0 !== (flags & FLAG_NEXT)) {
		at = readCString(data, at).next;
		at = readCString(data, at).next;
	}
	if (at + folderCount * FOLDER_RECORD_SIZE > data.length) return undefined;
	const folders: CabLayout["folders"] = [];
	for (let index = 0; index < folderCount; index += 1) {
		const record = at + index * FOLDER_RECORD_SIZE;
		// The word of a folder names the kind of its compression in its low byte and carries a parameter of
		// that compression in its high byte, so the kind stands apart from the parameter here.
		const word = data.readUInt16LE(record + 6);
		folders.push({
			start: data.readUInt32LE(record),
			blocks: data.readUInt16LE(record + 4),
			compression: word & 0x000f,
			parameter: word >> 8,
		});
	}
	if (filesAt >= data.length) return undefined;
	// The name of a file stands behind the record of it, so the table is walked record by record rather than
	// by a fixed stride: the place of the record of a file is only known once the names before it are read.
	const files: CabLayout["files"] = [];
	let record = filesAt;
	for (let index = 0; index < fileCount; index += 1) {
		if (record + FILE_RECORD_SIZE > data.length) return undefined;
		const folder = data.readUInt16LE(record + 8);
		if (folder >= folderCount) return undefined;
		const name = readCString(data, record + FILE_RECORD_SIZE);
		if ("" === name.text) return undefined;
		files.push({
			length: data.readUInt32LE(record),
			offset: data.readUInt32LE(record + 4),
			folder,
			name: name.text,
		});
		record = name.next;
	}
	return { length, versionMajor, versionMinor, cabinet, folders, files };
}

/** The blocks of one folder, unfolded into the bytes the files of it stand in. */
export function unfoldCabFolder(
	data: Buffer,
	folder: CabLayout["folders"][number],
): Buffer {
	if (
		COMPRESSION_NONE !== folder.compression &&
		COMPRESSION_MSZIP !== folder.compression
	) {
		throw unsupportedArchive(
			"The folder of the cabinet stands of a kind of compression this reader does not read",
		);
	}
	if (folder.start >= data.length) {
		throw invalidArchive("The blocks of the folder stand outside the cabinet");
	}
	const parts: Buffer[] = [];
	let history: Buffer = Buffer.alloc(0);
	let at = folder.start;
	for (let index = 0; index < folder.blocks; index += 1) {
		if (at + BLOCK_HEAD_SIZE > data.length) {
			throw invalidArchive(
				"The blocks of the folder stand short of the cabinet",
			);
		}
		const size = data.readUInt16LE(at + 4);
		const unfolded = data.readUInt16LE(at + 6);
		at += BLOCK_HEAD_SIZE;
		if (0 === size || at + size > data.length) {
			throw invalidArchive(
				"The blocks of the folder stand short of the cabinet",
			);
		}
		const block = data.subarray(at, at + size);
		at += size;
		if (COMPRESSION_NONE === folder.compression) {
			parts.push(Buffer.from(block));
			continue;
		}
		if (!block.subarray(0, MSZIP_SIGNATURE.length).equals(MSZIP_SIGNATURE)) {
			throw invalidArchive(
				"A block of the folder stands of no words of its own",
			);
		}
		let unfoldedBlock: Buffer;
		try {
			unfoldedBlock = inflateRawSync(
				block.subarray(MSZIP_SIGNATURE.length),
				0 === history.length ? {} : { dictionary: history },
			);
		} catch {
			throw invalidArchive(
				"The block of the folder stands of no deflate stream",
			);
		}
		if (0 !== unfolded && unfolded !== unfoldedBlock.length) {
			throw invalidArchive(
				"A block of the folder unfolds to a length it does not name",
			);
		}
		parts.push(unfoldedBlock);
		// The window of the block behind this one reaches back over the last thirty two thousand bytes of
		// everything the folder has unfolded so far.
		const unfoldedSoFar = Buffer.concat([history, unfoldedBlock]);
		history =
			unfoldedSoFar.length > MSZIP_WINDOW
				? Buffer.from(
						unfoldedSoFar.subarray(unfoldedSoFar.length - MSZIP_WINDOW),
					)
				: unfoldedSoFar;
	}
	return Buffer.concat(parts);
}

export const microsoftCabArchiveDescriptor: FormatDescriptor = {
	id: "microsoft-cab-archive",
	name: "Microsoft cabinet archive",
	extensions: [],
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
			source: "Experimental/Cabinet/ArcCAB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const microsoftCabArchiveFormat = defineFixedArchive({
	descriptor: microsoftCabArchiveDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, Number(source.size)));
			return readCabLayout(data) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readCabLayout(data);
		if (!layout) throw invalidArchive("Not a cabinet of Microsoft");
		const entries: FixedEntry[] = [];
		for (const file of layout.files) {
			// A file that continues into the cabinet behind this one names no length of its own, so the
			// length of what is extracted of it is not known before its folder is unfolded.
			const continued = CONTINUED === file.length;
			const name = normalizeEntryPath(file.name);
			const entry = createFixedEntry({
				id: String(entries.length),
				path: name.path,
				...(name.rawPath === undefined ? {} : { rawPath: name.rawPath }),
				offset: 0n,
				size: BigInt(file.length),
				// What the entry hands over is the bytes of the file unfolded, not the bytes it stands in.
				compressed: true,
				metadata: {
					folder: file.folder,
					folderOffset: file.offset,
					continued,
				},
			});
			if (continued) entry.sizeKnown = false;
			entries.push(entry);
		}
		return {
			entries,
			metadata: {
				versionMajor: layout.versionMajor,
				versionMinor: layout.versionMinor,
				cabinet: layout.cabinet,
				folders: layout.folders.length,
				length: layout.length,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readCabLayout(data);
		if (!layout) throw invalidArchive("Not a cabinet of Microsoft");
		const file = layout.files[Number(entry.id)];
		const folder = file === undefined ? undefined : layout.folders[file.folder];
		if (!file || !folder) {
			throw invalidArchive("The file stands in no folder of the cabinet");
		}
		const unfolded = unfoldCabFolder(data, folder);
		const from = file.offset;
		// A file that continues into the cabinet behind this one stands of a length of nought and thirty two
		// ones, and takes everything its folder holds behind its own place.
		const length =
			CONTINUED === file.length ? unfolded.length - from : file.length;
		if (from > unfolded.length || from + length > unfolded.length) {
			throw invalidArchive("The file stands outside the folder of the cabinet");
		}
		return Readable.from([Buffer.from(unfolded.subarray(from, from + length))]);
	},
});
