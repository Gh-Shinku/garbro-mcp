// Format reference: GARbro "Legacy/GPlay/ArcYSK.cs", classes `YskOpener` and the `DesTransform` beside it.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError, decodeCp932 } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { GplayDes } from "./des.js";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The key of the walk of the places of the file of the cipher of the engine stands of the engine itself. */
const DEFAULT_KEY = 0x1234567812345678n;
/** The picture of the engine opens with the letters `AA` and ten places of the file of the digits of it. */
const LETTERS = "AA";
const DIGITS = 10;
const COUNT_FIELD = 12;
const INDEX_POSITION = 0x10;
const ENTRY_SIZE = 0x18;
const NAME_SIZE = 0x14;
const SIGNATURES = [
	0x36314141, 0x39324141, 0x37374141, 0x38314141, 0x33314141, 0x39314141,
	0x32374141,
];
const BMP_BITS_FIELD = 0x1c;
const BMP_PIXELS = 0x36;
const BMP_TAIL = 0x493aa;
const BMP_STRIDE = 0xa0;
const BMP_HEAD = 8;
/** The places of the file of the walk of the places of the file of a picture of the engine. */
const JPG_BLOCK = 0x1000;
const JPG_HEAD = 8;

const TEXT_MARKS = [0x23, 0x2a];

export interface YskEntry {
	name: string;
	offset: bigint;
	size: number;
	kind: "text" | "jpg" | "bmp" | "raw";
}

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function kindOf(name: string): "text" | "jpg" | "bmp" | "raw" {
	const upper = name.toUpperCase();
	if (upper.endsWith(".TXT") || upper.endsWith(".DAT")) return "text";
	if (upper.endsWith(".JPG")) return "jpg";
	if (upper.endsWith(".BMP")) return "bmp";
	return "raw";
}

/** `YskOpener.TryOpen`: the places of the file of the index of the archive, of the places of the head. */
export function readYskIndex(data: Buffer): YskEntry[] | undefined {
	if (data.length < INDEX_POSITION) return undefined;
	if (LETTERS !== data.subarray(0, 2).toString("latin1")) return undefined;
	const digits = data.subarray(2, 2 + DIGITS).toString("latin1");
	if (!/^[0-9]+$/.test(digits)) return undefined;
	const count = data.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	let at = INDEX_POSITION;
	let offset = BigInt(INDEX_POSITION + count * ENTRY_SIZE);
	const entries: YskEntry[] = [];
	for (let place = 0; place < count; place += 1) {
		if (at + ENTRY_SIZE > data.length) return undefined;
		const field = data.subarray(at, at + NAME_SIZE);
		const end = field.indexOf(0);
		const name = decodeCp932(field.subarray(0, end < 0 ? field.length : end));
		const size = data.readUInt32LE(at + NAME_SIZE);
		if (offset + BigInt(size) > BigInt(data.length)) return undefined;
		entries.push({ name, offset, size, kind: kindOf(name) });
		at += ENTRY_SIZE;
		offset += BigInt(size);
	}
	return entries;
}

/** The marks the reference registers as its signatures. */
export function yskSignatures(): readonly { bytes: Uint8Array }[] {
	return SIGNATURES.map((word) => {
		const bytes: Buffer = Buffer.alloc(4, 0x00);
		bytes.writeUInt32LE(word >>> 0, 0);
		return { bytes };
	});
}

/** `YskOpener.OpenEntry`: the places of the file of an entry, of the walks of the cipher of the engine. */
export function unpackYskEntry(data: Buffer, entry: YskEntry): Buffer {
	const output = Buffer.from(data);
	const des = new GplayDes(DEFAULT_KEY);
	if ("text" === entry.kind) {
		if (TEXT_MARKS.includes(output[0] ?? 0)) return output;
		des.transform(output, 0, output.length);
		return output;
	}
	if ("jpg" === entry.kind) {
		for (let at = 0; at < output.length; at += JPG_BLOCK) {
			des.transform(output, at, Math.min(JPG_HEAD, output.length - at));
		}
		return output;
	}
	if ("bmp" === entry.kind) {
		if (output.length < BMP_BITS_FIELD + 2) return output;
		const bits = output.readUInt16LE(BMP_BITS_FIELD);
		// The places of the file of the BMP of the engine stand of the places of a colour of a place of the
		// picture of the walk of the engine itself, of no places of the file of a picture of the engine.
		if (4 === bits) output.writeUInt16LE(8, BMP_BITS_FIELD);
		else if (16 === bits) output.writeUInt16LE(24, BMP_BITS_FIELD);
		if (output.length - BMP_PIXELS > BMP_TAIL) {
			for (
				let at = BMP_PIXELS + BMP_TAIL;
				at + BMP_HEAD <= output.length;
				at += BMP_STRIDE
			) {
				des.transform(output, at, BMP_HEAD);
			}
		}
		return output;
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const yskDescriptor: FormatDescriptor = {
	id: "gplay-ysk-archive",
	name: "GPlay engine resource archive",
	extensions: ["ysk"],
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
			source: "Legacy/GPlay/ArcYSK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const yskFormat: ArchiveFormat = defineFixedArchive({
	descriptor: yskDescriptor,
	detection: { signatures: yskSignatures(), extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(INDEX_POSITION)) return false;
		try {
			return readYskIndex(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const entries = readYskIndex(await readStored(source));
		if (!entries) throw invalidArchive("Not an archive of the GPlay engine");
		const listed: FixedEntry[] = entries.map((entry, at) =>
			createFixedEntry({
				id: at,
				path: entry.name,
				offset: entry.offset,
				size: BigInt(entry.size),
				compressed: "raw" !== entry.kind,
				encrypted:
					"text" === entry.kind || "jpg" === entry.kind || "bmp" === entry.kind,
				metadata: { kind: entry.kind },
			}),
		);
		return { entries: listed, metadata: { entries: listed.length } };
	},
	async openEntry(source: ByteSource, entry) {
		const entries = readYskIndex(await readStored(source));
		if (!entries) throw invalidArchive("Not an archive of the GPlay engine");
		const at = Number(entry.id);
		const found = entries[at];
		if (!found) {
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entry.id}`,
			);
		}
		const data = Buffer.from(await source.readAt(found.offset, found.size));
		return Readable.from([unpackYskEntry(data, found)]);
	},
});
