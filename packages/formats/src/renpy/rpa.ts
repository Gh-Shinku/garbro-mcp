import { GarbroError } from "@garbro-mcp/core";
import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";

const RPA_MARK = Buffer.from("RPA-", "latin1");
const VERSION_WORD = 0x20302e33;
const INDEX_PLACES = 8;
const INDEX_SIZE = 16;
const KEY_PLACES = 0x19;
const KEY_SIZE = 8;
const MOST_PROTOCOL = 2;
const LONG_PLACES = 8;
const LEAST_TUPLE = 2;
const PLAIN_TUPLE = 2;
const OFFSET_IN_TUPLE = 0;
const SIZE_IN_TUPLE = 1;
const HEAD_IN_TUPLE = 2;
const LIMIT = 1_000_000;
const BYTE_LIMIT = 4 * 1024 * 1024 * 1024;

const PROTO = 0x80;
const TUPLE2 = 0x86;
const TUPLE3 = 0x87;
const LONG1 = 0x8a;
const LONG4 = 0x8b;
const MARK = 0x28;
const STOP = 0x2e;
const INT = 0x49;
const BININT = 0x4a;
const BININT1 = 0x4b;
const BININT2 = 0x4d;
const BINSTRING = 0x54;
const SHORT_BINSTRING = 0x55;
const BINUNICODE = 0x58;
const EMPTY_LIST = 0x5d;
const APPEND = 0x61;
const BINPUT = 0x71;
const LONG_BINPUT = 0x72;
const SETITEM = 0x73;
const SETITEMS = 0x75;
const EMPTY_DICT = 0x7d;
const PLACES_OF_THE_WORD = 8;
const DECIMAL_END = 0x0a;
const LEAST_WORDS = 4;

export interface RpaPlace {
	path: string;
	offset: number;
	size: number;
	head: Buffer;
}

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

class PickleReader {
	private readonly stack: unknown[] = [];
	private readonly marks: number[] = [];
	private at = 0;

	constructor(private readonly input: Buffer) {}

	private readByte(): number | undefined {
		if (this.at >= this.input.length) return undefined;
		const value = this.input[this.at] ?? 0;
		this.at += 1;
		return value;
	}

	private readInt(count: number): number | undefined {
		if (this.at + count > this.input.length) return undefined;
		let value = 0;
		for (let i = 0; i < count; i += 1) {
			value |= (this.input[this.at + i] ?? 0) << (i * PLACES_OF_THE_WORD);
		}
		this.at += count;
		return value;
	}

	private readLong(count: number): bigint {
		if (count <= 0) return 0n;
		if (count > LONG_PLACES)
			throw invalidArchive(
				"The places of the picture of the walk of the places of the picture of the walk of them stand of more places of the picture than the places of the picture of the walk of the places of the picture of this project stand",
			);
		if (this.at + count > this.input.length)
			throw invalidArchive(
				"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
			);
		const bytes = Buffer.alloc(LONG_PLACES, 0x00);
		this.input.copy(bytes, 0, this.at, this.at + count);
		this.at += count;
		if (((bytes[count - 1] ?? 0) & 0x80) !== 0) {
			for (let i = count; i < LONG_PLACES; i += 1) bytes[i] = 0xff;
		}
		return bytes.readBigInt64LE(0);
	}

	private push(value: unknown): void {
		this.stack.push(value);
	}

	private popToPlaces(mark: number): unknown[] {
		const slice = this.stack.slice(mark);
		this.stack.length = mark;
		return slice;
	}

	private setItems(mark: number): void {
		if (!(this.stack.length >= mark && mark > 0))
			throw invalidArchive(
				"The places of the picture of the walk of the places of the picture of the words of the walk of the picture stand short of the places of the picture",
			);
		const dict = this.stack[mark - 1];
		if (!(dict instanceof Map))
			throw invalidArchive(
				"The places of the picture of the walk of the places of the picture of the places of the picture of the walk of them stand of no places of the picture of the walk of the places of the picture of the walk of them",
			);
		for (let i = mark + 1; i < this.stack.length; i += 2) {
			dict.set(this.stack[i - 1] as Uint8Array, this.stack[i] as unknown);
		}
		this.popToPlaces(mark);
	}

	private countedTuple(count: number): void {
		if (this.stack.length < count)
			throw invalidArchive(
				"The places of the picture of the walk of the places of the picture of the words of the walk of the picture stand short of the places of the picture",
			);
		const tuple = this.stack.splice(this.stack.length - count, count);
		this.push(tuple);
	}

	load(): unknown {
		for (;;) {
			const symbol = this.readByte();
			if (symbol === undefined || symbol === 0) {
				throw invalidArchive(
					"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
				);
			}
			if (symbol === PROTO) {
				const kind = this.readByte();
				if (kind === undefined || kind > MOST_PROTOCOL)
					throw invalidArchive(
						"The places of the picture of the walk of the places of the picture stand of the kind of the walk of the places of the picture of no places of the picture of the walk of them",
					);
				continue;
			}
			if (symbol === EMPTY_DICT) {
				this.push(new Map<Uint8Array, unknown>());
				continue;
			}
			if (symbol === EMPTY_LIST) {
				this.push([]);
				continue;
			}
			if (symbol === MARK) {
				this.marks.push(this.stack.length);
				continue;
			}
			if (symbol === BINPUT) {
				const key = this.readByte();
				if (key === undefined || this.stack.length === 0)
					throw invalidArchive(
						"The places of the picture of the walk of the places of the picture of the words of the walk of the picture stand short of the places of the picture",
					);
				continue;
			}
			if (symbol === LONG_BINPUT) {
				const key = this.readInt(LEAST_WORDS);
				if (key === undefined || key < 0 || this.stack.length === 0)
					throw invalidArchive(
						"The places of the picture of the walk of the places of the picture of the words of the walk of the picture stand short of the places of the picture",
					);
				continue;
			}
			if (symbol === SHORT_BINSTRING) {
				const length = this.readByte();
				if (length === undefined || this.at + length > this.input.length)
					throw invalidArchive(
						"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
					);
				this.push(Buffer.from(this.input.subarray(this.at, this.at + length)));
				this.at += length;
				continue;
			}
			if (symbol === BINSTRING || symbol === BINUNICODE) {
				const length = this.readInt(LEAST_WORDS);
				if (
					length === undefined ||
					length < 0 ||
					this.at + length > this.input.length
				)
					throw invalidArchive(
						"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
					);
				this.push(Buffer.from(this.input.subarray(this.at, this.at + length)));
				this.at += length;
				continue;
			}
			if (symbol === BININT || symbol === BININT1 || symbol === BININT2) {
				const size = symbol === BININT ? 4 : symbol === BININT1 ? 1 : 2;
				const value = this.readInt(size);
				if (value === undefined)
					throw invalidArchive(
						"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
					);
				this.push(BigInt(value >>> 0));
				continue;
			}
			if (symbol === INT) {
				let text = "";
				for (;;) {
					const place = this.readByte();
					if (place === undefined || place === DECIMAL_END) break;
					text += String.fromCharCode(place);
				}
				if (!/^-?\d+$/.test(text))
					throw invalidArchive(
						"The places of the picture of the walk of the places of the picture stand of no places of the picture of the walk of them",
					);
				this.push(BigInt(text));
				continue;
			}
			if (symbol === TUPLE2 || symbol === TUPLE3) {
				this.countedTuple(symbol === TUPLE2 ? 2 : 3);
				continue;
			}
			if (symbol === LONG1) {
				const count = this.readByte();
				if (count === undefined)
					throw invalidArchive(
						"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
					);
				this.push(this.readLong(count));
				continue;
			}
			if (symbol === LONG4) {
				const count = this.readInt(LEAST_WORDS);
				if (count === undefined || count < 0)
					throw invalidArchive(
						"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
					);
				this.push(this.readLong(count));
				continue;
			}
			if (symbol === APPEND) {
				const start = this.stack.length - 1;
				if (start <= 0)
					throw invalidArchive(
						"The places of the picture of the walk of the places of the picture of the words of the walk of the picture stand short of the places of the picture",
					);
				const list = this.stack[start - 1];
				if (!Array.isArray(list))
					throw invalidArchive(
						"The places of the picture of the walk of the places of the picture of the places of the picture of the walk of them stand of no places of the picture of the walk of the places of the picture of the walk of them",
					);
				list.push(...this.popToPlaces(start));
				continue;
			}
			if (symbol === SETITEM) {
				this.setItems(this.stack.length - LEAST_TUPLE);
				continue;
			}
			if (symbol === SETITEMS) {
				const mark = this.marks.pop();
				if (mark === undefined)
					throw invalidArchive(
						"The places of the picture of the walk of the places of the picture of the words of the walk of the picture stand short of the places of the picture",
					);
				this.setItems(mark);
				continue;
			}
			if (symbol === STOP) break;
			throw invalidArchive(
				"The places of the picture of the walk of the places of the picture of the words of the walk of the picture stand of the kind of the places of the picture of the walk of them of no places of the picture of the walk of them",
			);
		}
		if (this.stack.length === 0)
			throw invalidArchive(
				"The places of the picture of the walk of the places of the picture of the words of the walk of the picture stand of no places of the picture of the walk of them",
			);
		return this.stack[this.stack.length - 1];
	}
}

export async function readRpaIndex(
	data: Buffer,
	fileLength = data.length,
): Promise<RpaPlace[] | undefined> {
	if (fileLength < KEY_PLACES + KEY_SIZE || data.length < KEY_PLACES + KEY_SIZE)
		return undefined;
	if (!data.subarray(0, RPA_MARK.length).equals(RPA_MARK)) return undefined;
	if (data.readUInt32LE(4) !== VERSION_WORD) return undefined;
	const indexText = data
		.subarray(INDEX_PLACES, INDEX_PLACES + INDEX_SIZE)
		.toString("latin1");
	const keyText = data
		.subarray(KEY_PLACES, KEY_PLACES + KEY_SIZE)
		.toString("latin1");
	if (!/^[0-9a-fA-F]+$/.test(indexText)) return undefined;
	if (!/^[0-9a-fA-F]+$/.test(keyText)) return undefined;
	const indexOffset = Number.parseInt(indexText, 16);
	if (
		!Number.isSafeInteger(indexOffset) ||
		indexOffset >= fileLength ||
		indexOffset < 0
	)
		return undefined;
	const key = Number.parseInt(keyText, 16);
	let packed: Uint8Array;
	try {
		packed = await inflateZlibBuffer(data.subarray(indexOffset));
	} catch {
		return undefined;
	}
	const dict = new PickleReader(Buffer.from(packed)).load();
	if (!(dict instanceof Map)) return undefined;
	const places: RpaPlace[] = [];
	for (const [rawName, values] of dict) {
		if (!(rawName instanceof Uint8Array) || !Array.isArray(values))
			return undefined;
		if (values.length < 1) return undefined;
		const tuple = values[OFFSET_IN_TUPLE];
		if (!Array.isArray(tuple) || tuple.length < LEAST_TUPLE) return undefined;
		const offsetPlace = tuple[OFFSET_IN_TUPLE];
		const sizePlace = tuple[SIZE_IN_TUPLE];
		if (typeof offsetPlace !== "bigint" || typeof sizePlace !== "bigint")
			return undefined;
		const path = Buffer.from(rawName).toString("utf8");
		if (path.length === 0) return undefined;
		const offset = Number(offsetPlace ^ BigInt(key));
		const unpacked = Number(sizePlace ^ BigInt(key));
		if (unpacked < 0 || offset < 0 || offset > fileLength) return undefined;
		if (unpacked > BYTE_LIMIT) return undefined;
		let head = Buffer.alloc(0);
		if (tuple.length > PLAIN_TUPLE) {
			const headPlace = tuple[HEAD_IN_TUPLE];
			if (headPlace instanceof Uint8Array) head = Buffer.from(headPlace);
		}
		places.push({ path, offset, size: unpacked - head.length, head });
		if (places.length > LIMIT) return undefined;
	}
	return places.length > 0 ? places : undefined;
}

export const renpyRpaDescriptor: FormatDescriptor = {
	id: "renpy-rpa",
	name: "Ren'Py archive",
	extensions: ["rpa"],
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
			source: "ArcFormats/RenPy/ArcRPA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const renpyRpaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: renpyRpaDescriptor,
	detection: { signatures: [{ bytes: RPA_MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(KEY_PLACES + KEY_SIZE)) return false;
		try {
			const data = Buffer.from(
				await source.readAt(0n, Math.min(Number(source.size), 0x1000)),
			);
			if (!data.subarray(0, RPA_MARK.length).equals(RPA_MARK)) return false;
			if (data.readUInt32LE(4) !== VERSION_WORD) return false;
			return (await readRpaIndex(data, Number(source.size))) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, _sourcePath: string) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const places = await readRpaIndex(stored, Number(source.size));
		if (!places) throw invalidArchive("Not an archive of this kind");
		return {
			entries: places.map((place, id) =>
				createFixedEntry({
					id,
					path: normalizeEntryPath(place.path).path,
					offset: BigInt(place.offset),
					size: BigInt(place.size),
					packedSize: BigInt(place.size + place.head.length),
					compressed: place.head.length > 0,
					metadata: { type: "binary", head: place.head.length },
				}),
			),
			metadata: { entries: places.length },
		};
	},
	async openEntry(source: ByteSource, entry) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const places = await readRpaIndex(stored, Number(source.size));
		const place = places?.find(
			(candidate) => candidate.offset === Number(entry.offset),
		);
		if (!place)
			throw invalidArchive(
				"No places of the picture of the walk of the places of the picture",
			);
		return Readable.from([
			Buffer.concat([
				place.head,
				stored.subarray(place.offset, place.offset + place.size),
			]),
		]);
	},
});
