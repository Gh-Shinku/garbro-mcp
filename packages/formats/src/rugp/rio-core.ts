// Port of the core of the rUGP object manager: the walks of `CRioArchive` and the helpers of `RioReader`
// (`ArcFormats/rUGP/ArcRIO.cs`), with the bit stream of `ArcFormats/BitStream.cs` behind the class names.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The archives of this engine carry no index of their own: they carry a **serialised object graph**, and the
// places of the pictures and the sounds of a game are the places of the objects of that graph. This module is
// the reading half of it: the primitives of the stream (the lengths of the strings, the counts, the booleans
// and the four byte lengths), the **class tags** of the object walk (a place of sixteen places that names a
// class either of the two tables the stream carries or of a class written in the stream itself, scrambled
// with a tree of characters of the engine), and the walk of an `.ici` payload that gives an archive its index.
//
// The objects themselves (the class table of `s_classTable`, the `CObject` walks and the archive of a game)
// stand behind this module rather than in it: it hands back the names of the classes and leaves the places of
// an object to the callers, which is the half the picture formats of the engine stand of.

import { decodeCp932 } from "@garbro-mcp/core";

/** The four marks of the engine: the archive itself, an encrypted archive, an object and an `.ici` payload. */
export const RIO_SIGNATURE = 0x596e32cd;
export const RIO_ENCRYPTED_SIGNATURE = 0x1edb927c;
export const RIO_OBJECT_SIGNATURE = 0x29f6cba4;
export const RIO_ICI_SIGNATURE = 0x673ce92a;
export const RIO_CORE_SIGNATURES: readonly number[] = [
	RIO_ICI_SIGNATURE,
	RIO_ENCRYPTED_SIGNATURE,
	RIO_SIGNATURE,
	RIO_OBJECT_SIGNATURE,
];
/** The key an `.ici` payload of the engine stands of. */
export const RIO_ICI_KEY = 0xb29d5a0c;
/** The places the walk of an `.ici` payload stands of, and the count of its checksum places. */
const ICI_SIZE_XOR = 0xc92e568b;
const ICI_SIZE_YOR = 0xc92e568f;
const ICI_CHUNK_PLACES = 0x20;
const ICI_KEY_STEP = 0xa3b376c9;
/** The places the places and the counts of an encrypted object of the engine stand of. */
const OBJECT_OFFSET_SUB = 0xa2fb6ad1;
const OBJECT_SIZE_SUB = 0xe7b5d9f8;
/** The places of the walk of the length of a string, and of a count. */
const STRING_LENGTH_BYTE = 0xff;
const STRING_LENGTH_UNICODE = 0xfffe;
const STRING_LENGTH_WORD = 0xffff;
const COUNT_WORD = 0xffff;
const SHORT_COUNT_BYTE = 0xff;
/** The places of the tags of a class name, and the count of the places of a name of the stream itself. */
const CLASS_TAG_INLINE = 0x7fff;
const CLASS_TAG_STREAM = 0xffff;
const CLASS_TAG_WORD = 0x8000;
const CLASS_NAME_PLACES = 0x40;
const CLASS_NAME_SCRAMBLED = 0x100;
/** The tables the scrambled names of a class of the engine stand of. */
const CHAR_MAP_1 = "eaitrosducmnSglR";
const CHAR_MAP_2 = "\u0001COFLfBMxphyAVbI";
const CHAR_MAP_3 = "EHTDPWXkqvNjwGz02U_K15JQZ467839\u0000";
/** The basic types of the engine, keyed by the names it writes them of. */
export const RIO_BASIC_TYPES: ReadonlyMap<string, string> = new Map([
	["バイト", "byte"],
	["短正整数", "short"],
	["短整数", "ushort"],
	["正整数", "int"],
	["整数", "uint"],
	["色", "Color"],
]);
/** The classes the archive opener of the engine reads, of the kind of every one of them. */
export const RIO_SUPPORTED_CLASSES: ReadonlyMap<string, string> = new Map([
	["CRip007", "image"],
	["CRip", "image"],
	["CS5i", "image"],
	["CIcon", "image"],
	["CRsa", "script"],
	["CVmFunc", "script"],
	["CWaveAudio", "audio"],
	["CrelicHicompAudio", "audio"],
]);
/** The classes of the object graph the engine names in the stream itself. */
export const RIO_CLASS_NAMES: readonly string[] = [
	"CObjectArcMan",
	"CrelicUnitedGameProject",
	"CStdb",
	"CObjectOcean",
	"CBoxOcean",
];

/** The stream of the engine: a cursor that reads of a run of places. */
export class RioStream {
	readonly data: Buffer;
	#position = 0;

	constructor(data: Buffer) {
		this.data = data;
	}

	get position(): number {
		return this.#position;
	}

	set position(at: number) {
		this.#position = Math.max(0, Math.min(at, this.data.length));
	}

	get remaining(): number {
		return this.data.length - this.#position;
	}

	readByte(): number | undefined {
		if (this.#position >= this.data.length) return undefined;
		const place = this.data[this.#position] ?? 0;
		this.#position += 1;
		return place;
	}

	readUInt16(): number | undefined {
		if (this.#position + 2 > this.data.length) return undefined;
		const place = this.data.readUInt16LE(this.#position);
		this.#position += 2;
		return place;
	}

	readUInt32(): number | undefined {
		if (this.#position + 4 > this.data.length) return undefined;
		const place = this.data.readUInt32LE(this.#position);
		this.#position += 4;
		return place;
	}

	readInt32(): number | undefined {
		const place = this.readUInt32();
		return place === undefined ? undefined : place | 0;
	}

	readInt64(): bigint | undefined {
		if (this.#position + 8 > this.data.length) return undefined;
		const place = this.data.readBigInt64LE(this.#position);
		this.#position += 8;
		return place;
	}

	readBytes(count: number): Buffer | undefined {
		if (count < 0 || this.#position + count > this.data.length)
			return undefined;
		const run = this.data.subarray(this.#position, this.#position + count);
		this.#position += count;
		return run;
	}

	seekBack(count: number): void {
		this.#position = Math.max(0, this.#position - count);
	}
}

/** The bit stream of the engine, read from the lowest place of a byte up (`LsbBitStream`). */
export class RioBitReader {
	readonly #stream: RioStream;
	#bits = 0;
	#cached = 0;

	constructor(stream: RioStream) {
		this.#stream = stream;
	}

	/** `GetBits`: `-1` where the stream ends of its places. */
	getBits(count: number): number {
		let wanted = count;
		let value: number;
		if (this.#cached >= wanted) {
			const mask = (1 << wanted) - 1;
			value = this.#bits & mask;
			this.#bits >>>= wanted;
			this.#cached -= wanted;
		} else {
			value = this.#bits & ((1 << this.#cached) - 1);
			wanted -= this.#cached;
			let shift = this.#cached;
			this.#cached = 0;
			while (wanted >= 8) {
				const place = this.#stream.readByte();
				if (place === undefined) return -1;
				value |= place << shift;
				shift += 8;
				wanted -= 8;
			}
			if (wanted > 0) {
				const place = this.#stream.readByte();
				if (place === undefined) return -1;
				value |= (place & ((1 << wanted) - 1)) << shift;
				this.#bits = place >>> wanted;
				this.#cached = 8 - wanted;
			}
		}
		return value >>> 0;
	}

	getNextBit(): number {
		return this.getBits(1);
	}
}

/** `CRioArchive.ReadString`: a length of one, two or four places and then the places of a cp932 string. */
export function readRioString(stream: RioStream): string | undefined {
	const length = readRioStringLength(stream);
	if (length === undefined) return undefined;
	if (length === 0) return "";
	if (length < 0) return undefined;
	const run = stream.readBytes(length);
	if (run === undefined || run.length !== length) return undefined;
	return decodeCp932(run);
}

/** `ReadStringLength`: the length of a string, of the places the engine writes it in. */
export function readRioStringLength(stream: RioStream): number | undefined {
	const first = stream.readByte();
	if (first === undefined) return undefined;
	if (first < STRING_LENGTH_BYTE) return first;
	const second = stream.readUInt16();
	if (second === undefined) return undefined;
	if (second === STRING_LENGTH_UNICODE) return undefined;
	if (second < STRING_LENGTH_WORD) return second;
	return stream.readInt32();
}

/** `ReadCount`: a count of sixteen places, or `0xFFFF` and a count of thirty two. */
export function readRioCount(stream: RioStream): number | undefined {
	const count = stream.readUInt16();
	if (count === undefined) return undefined;
	return count === COUNT_WORD ? stream.readInt32() : count;
}

/** `ReadShortCount`: a count of one place, or `0xFF` and a count of sixteen. */
export function readRioShortCount(stream: RioStream): number | undefined {
	const count = stream.readByte();
	if (count === undefined) return undefined;
	return count === SHORT_COUNT_BYTE ? stream.readUInt16() : count;
}

/** `ReadBool`. */
export function readRioBool(stream: RioStream): boolean | undefined {
	const place = stream.readByte();
	return place === undefined ? undefined : place !== 0;
}

/** `DecodeOffset`: the place of an object of an encrypted archive. */
export function decodeRioOffset(offset: number): number {
	return (offset - OBJECT_OFFSET_SUB) >>> 0;
}

/** `DecodeSize`: the count of the places of an object of an encrypted archive. */
export function decodeRioSize(size: number): number {
	const a = (size - OBJECT_SIZE_SUB) >>> 0;
	const b = a >>> 13;
	return ((((a - (b & 0xfff)) >>> 0) << 19) | b) >>> 0;
}

/**
 * `CRioArchive.ReadEncrypted`: a payload of an `.ici` file. Every place of it stands of a key that walks a
 * turn of its own, and every run of thirty two places stands of a checksum of sixteen places behind it.
 */
export function readRioEncrypted(
	stream: RioStream,
	key: number,
): Buffer | undefined {
	const first = stream.readUInt32();
	const second = stream.readUInt32();
	if (first === undefined || second === undefined) return undefined;
	const size1 = ~(first ^ ICI_SIZE_XOR) >>> 0;
	const size2 = ((second ^ ICI_SIZE_YOR) >>> 0) >>> 3;
	if (size1 !== size2) return undefined;
	const output = Buffer.alloc(size1, 0x00);
	let rolling = key >>> 0;
	let destination = 0;
	while (destination < output.length) {
		let checksum = 0;
		let portion = Math.min(ICI_CHUNK_PLACES, output.length - destination);
		const run = stream.readBytes(portion);
		if (run === undefined) return undefined;
		portion = run.length;
		for (let left = portion; left > 0; left -= 1) {
			const place = ((run[run.length - left] ?? 0) ^ rolling) & 0xff;
			output[destination] = place;
			destination += 1;
			checksum = (checksum + place * left) & 0xffff;
			const bit = (rolling >>> 15) & 1;
			rolling = ~((bit + rolling * 2 + ICI_KEY_STEP) & 0xffffffff) >>> 0;
		}
		if (portion < ICI_CHUNK_PLACES) break;
		const stored = stream.readUInt16();
		if (stored === undefined || stored !== checksum) return undefined;
	}
	return output;
}

/**
 * `RioReader.DecryptIci`: the three column walks of an `.ici` payload, of the two accumulators between them.
 */
export function decryptRioIci(input: Buffer): Buffer {
	const output = Buffer.alloc(input.length, 0x00);
	const length = input.length;
	// The six columns of the first walk.
	let chunks = Math.floor(length / 6);
	let tail = length % 6;
	let src = 0;
	let dst = 0;
	for (let n = chunks; n > 0; n -= 1) {
		for (let column = 0; column < 6; column += 1) {
			output[dst] = input[src + column * chunks] ?? 0;
			dst += 1;
		}
		src += 1;
	}
	if (tail > 0) {
		input.copy(output, dst, length - tail, length);
		dst += tail;
	}
	let accumulator = 0;
	for (let at = 0; at < length; at += 1) {
		const place = ((output[at] ?? 0) - accumulator) & 0xff;
		output[at] = place;
		accumulator = (accumulator + place) & 0xff;
		output[at] = place ^ 0xa5;
	}
	// The five columns of the second walk, which stands of the run of the first one.
	const scratch = Buffer.from(input);
	chunks = Math.floor(length / 5);
	tail = length % 5;
	src = 0;
	dst = 0;
	for (let n = chunks; n > 0; n -= 1) {
		for (let column = 0; column < 5; column += 1) {
			scratch[dst] = output[src + column * chunks] ?? 0;
			dst += 1;
		}
		src += 1;
	}
	if (tail > 0) {
		output.copy(scratch, dst, length - tail, length);
		dst += tail;
	}
	accumulator = 0;
	for (let at = length - 1; at >= 0; at -= 1) {
		const place = ((scratch[at] ?? 0) - accumulator) & 0xff;
		scratch[at] = place;
		accumulator = (accumulator + place) & 0xff;
	}
	// The three columns of the last walk.
	chunks = Math.floor(length / 3);
	tail = length % 3;
	src = 0;
	dst = 0;
	const last = Buffer.alloc(length, 0x00);
	for (let n = chunks; n > 0; n -= 1) {
		last[dst] = (scratch[src] ?? 0) ^ 0x18;
		dst += 1;
		last[dst] = (scratch[src + chunks] ?? 0) ^ 0x3f;
		dst += 1;
		last[dst] = (scratch[src + chunks * 2] ?? 0) ^ 0xe2;
		dst += 1;
		src += 1;
	}
	if (tail > 0) {
		scratch.copy(last, dst, length - tail, length);
		dst += tail;
	}
	return last;
}

/**
 * `CRioArchive.DecodeClassName`: the name of a class written in a stream itself, of the tree of characters
 * the engine scrambles it with: a bit of nothing names a character of the first table, and a bit of one the
 * two behind it, where a place of nothing stands for a byte of the stream rather than for a character.
 */
export function decodeRioClassName(enc: Buffer): string | undefined {
	const stream = new RioStream(enc);
	const bits = new RioBitReader(stream);
	let out = "";
	if (bits.getNextBit() === 0) out += "C";
	for (;;) {
		const place = bits.getNextBit();
		if (place === -1) break;
		let character: number;
		if (place === 0) {
			const index = bits.getBits(4);
			if (index === -1) break;
			character = CHAR_MAP_1.charCodeAt(index);
		} else if (bits.getNextBit() !== 0) {
			const index = bits.getBits(5);
			if (index === -1) break;
			character = CHAR_MAP_3.charCodeAt(index);
		} else {
			const index = bits.getBits(4);
			if (index === -1) break;
			if (index !== 0) {
				character = CHAR_MAP_2.charCodeAt(index);
			} else {
				const place2 = bits.getBits(8);
				if (place2 === -1) break;
				character = place2;
			}
		}
		if (Number.isNaN(character)) break;
		out += String.fromCharCode(character);
	}
	return decodeCp932(Buffer.from(out, "latin1"));
}

/** `LoadRuntimeClass`: the schema and the name of a class, of the stream itself. */
export interface RioClassHeader {
	readonly schema: number;
	readonly className: string;
}

function loadRioRuntimeClass(stream: RioStream): RioClassHeader | undefined {
	const schema = stream.readUInt16();
	const length = stream.readUInt16();
	if (schema === undefined || length === undefined) return undefined;
	if (length >= CLASS_NAME_PLACES) return undefined;
	const run = stream.readBytes(length);
	if (run === undefined || run.length !== length) return undefined;
	return { schema, className: decodeCp932(run) };
}

function loadRioScrambledClass(stream: RioStream): RioClassHeader | undefined {
	const schema = stream.readUInt16();
	if (schema === undefined) return undefined;
	let length = stream.readByte();
	if (length === undefined) return undefined;
	if (length === 0xff) {
		const wide = stream.readUInt16();
		if (wide === undefined) return undefined;
		length = wide;
	}
	if (length >= CLASS_NAME_SCRAMBLED) return undefined;
	const run = stream.readBytes(length);
	if (run === undefined || run.length !== length) return undefined;
	const className = decodeRioClassName(run);
	return className === undefined ? undefined : { schema, className };
}

/**
 * The walk of the classes of an object graph: the tags of the classes, the classes the stream carries itself,
 * and the count of them the archive stands of.
 */
export class RioClassReader {
	readonly #loadArray: unknown[] = [null, this];
	#field4C = 0;
	#objectSchema = -1;

	get loadCount(): number {
		return this.#loadArray.length;
	}

	get objectSchema(): number {
		return this.#objectSchema;
	}

	get isEncrypted(): boolean {
		return 0 !== (this.#field4C & 4);
	}

	get field4C(): number {
		return this.#field4C;
	}

	/**
	 * `ReadClass`: a tag of sixteen places that names a class of the two tables of the archive, a tag of the
	 * stream where the tag reads `0xFFFF`, and a class of nothing where the highest place of the tag of a
	 * place of sixteen stands of nothing.
	 */
	readClass(
		stream: RioStream,
	): { className: string | null; tag: number } | undefined {
		const word = stream.readUInt16();
		if (word === undefined) return undefined;
		let tag: number;
		if (CLASS_TAG_INLINE === word) {
			const wide = stream.readInt32();
			if (wide === undefined) return undefined;
			tag = wide;
		} else {
			tag = (((word & CLASS_TAG_WORD) << 16) | (word & ~CLASS_TAG_WORD)) >>> 0;
		}
		if (0 === (tag & 0x80000000)) {
			return { className: null, tag: tag | 0 };
		}
		if (CLASS_TAG_STREAM === word) {
			const header =
				0 !== (this.#field4C & 8)
					? loadRioScrambledClass(stream)
					: loadRioRuntimeClass(stream);
			if (!header) return undefined;
			this.#objectSchema = header.schema;
			this.#loadArray.push(header.className);
			return { className: header.className, tag: tag | 0 };
		}
		const index = (tag & 0x7fffffff) >>> 0;
		if (0 === index || index >= this.#loadArray.length) return undefined;
		const found = this.#loadArray[index];
		return typeof found === "string"
			? { className: found, tag: tag | 0 }
			: undefined;
	}

	/**
	 * `LoadRioTypeCore`: the mark of an archive, the schema of the walk of it and the name of the class of its
	 * root. The schema of a mark of the two tables of sixteen places stands of a count of its own behind it.
	 */
	loadRioTypeCore(
		stream: RioStream,
	):
		| { signature: number; schema: number; className: string | null }
		| undefined {
		const signature = stream.readUInt32();
		if (signature === undefined || !RIO_CORE_SIGNATURES.includes(signature)) {
			return undefined;
		}
		let schema = -1;
		const version = stream.readUInt16();
		if (version === undefined) return undefined;
		if (version >= 0x10 && version <= 0x3fff) {
			schema = version;
			if (version >= 0x11) {
				const wide = stream.readUInt16();
				if (wide === undefined) return undefined;
				this.#field4C = (this.#field4C & 0xffff) | (wide << 16);
			}
		} else {
			stream.seekBack(2);
		}
		if (RIO_ENCRYPTED_SIGNATURE === signature) this.#field4C |= 0xc;
		const walked = this.readClass(stream);
		if (!walked) return undefined;
		return { signature, schema, className: walked.className };
	}
}
