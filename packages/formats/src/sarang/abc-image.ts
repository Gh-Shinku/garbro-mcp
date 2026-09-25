// Format reference: GARbro "Legacy/Sarang/ImageABC.cs", classes `AbcFormat` and the `AbcDecoder` beside it
// (tag `ABC`, the compressed picture of the Sarang engine). The picture behind the walks of this engine is a
// bitmap or a texture, which the reference hands to the readers of those pictures; this port does the same.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { MsbBitReader } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	readBmpImage,
	readBmpMetaData,
	writeBmp32,
	writeBmpImage,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readDdsLayout, readDdsPicture } from "../directdraw/dds-image.js";

const HEAD_SIZE = 8;
/** The places of the walks of a picture stand behind the head of it. */
const WALK_OFFSET = 4;
const MIN_UNPACKED_SIZE = 0x38;
const MAX_UNPACKED_SIZE = 4096 * 4096 * 4;
/** The word the head of a picture stands of, of either of the two places the reference names. */
const SIGNATURE_TAIL = 0x1321;
const SIGNATURE_TEXTURE = 0x620a1122;
/** The places of the picture the reference reads to tell the picture behind them. */
const HEAD_PLACES = 0x6c;
const BMP_MARK = Buffer.from("BM", "latin1");
const DDS_MARK = Buffer.from("DDS ", "latin1");
/** The places of the tables of the walks of the engine. */
const END = 0x1000;
const FIRST_TOKEN = 0x100;
const LETTERS = 0x100;
const TABLES = 0x1000;
const MAX_STRING = 100;
const TOKEN_LIMIT = 2;
const LIMIT = MAX_UNPACKED_SIZE;

export interface AbcLayout {
	unpackedSize: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	kind: "bmp" | "dds";
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `AbcDecoder`: the walks of the engine, of a tree of the places of the picture it has read, of lists of
 * the places of every one of them and of a walk of the places of the file itself.
 */
class AbcDecoder {
	private readonly bits: MsbBitReader;
	private readonly root = new Uint8Array(TABLES);
	private readonly dict1 = new Int32Array(TABLES);
	private readonly dict2 = new Int32Array(TABLES);
	private readonly dict3 = new Int32Array(TABLES);
	private readonly dict4 = new Int32Array(TABLES);
	private readonly table1 = new Int32Array(TABLES);
	private readonly table2 = new Int32Array(TABLES);
	private readonly buffer = new Uint8Array(MAX_STRING);
	private lastToken = FIRST_TOKEN;
	private field4 = END;
	private field8 = END;
	private tokenBits = 1;
	private tokenLimit = TOKEN_LIMIT;

	constructor(data: Buffer) {
		this.bits = new MsbBitReader(data, WALK_OFFSET);
		for (let at = 0; at < LETTERS; at += 1) {
			this.root[at] = at;
			this.dict1[at] = END;
			this.dict2[at] = END;
			this.dict3[at] = END;
			this.dict4[at] = END;
		}
	}

	/** `AbcDecoder.ReadToken`: the place of the picture the walk of the bits names. */
	private readToken(): number {
		if (this.lastToken - FIRST_TOKEN >= this.tokenLimit) {
			this.tokenLimit <<= 1;
			this.tokenBits += 1;
		}
		const first = this.bits.tryReadBits(1);
		if (first < 0)
			throw invalidPicture("The places of the picture stand short of the file");
		if (first > 0) {
			const token = this.bits.tryReadBits(this.tokenBits);
			if (token < 0)
				throw invalidPicture(
					"The places of the picture stand short of the file",
				);
			return token + FIRST_TOKEN;
		}
		const place = this.bits.tryReadBits(8);
		if (place < 0)
			throw invalidPicture("The places of the picture stand short of the file");
		return place;
	}

	/** `AbcDecoder.sub_411760`: the place of a table of the walks standing in front of the places of it. */
	private moveForward(token: number): void {
		if (token === this.field8) {
			this.field8 = this.table1[token] ?? END;
			this.table2[this.field8] = END;
			return;
		}
		const first = this.table1[token] ?? END;
		const second = this.table2[token] ?? END;
		this.table1[second] = first;
		this.table2[first] = second;
	}

	/** `AbcDecoder.sub_4117B0`: a place of the walks standing in front of the places of its own. */
	private standBefore(place: number, before: number): void {
		if (END === this.field4) {
			this.table1[place] = END;
			this.table2[place] = END;
			this.field8 = place;
			this.field4 = place;
		} else if (END === before) {
			this.table2[place] = END;
			this.table1[place] = this.field8;
			this.table2[this.field8] = place;
			this.field8 = place;
		} else if (before === this.field4) {
			this.table2[place] = this.field4;
			this.table1[place] = END;
			this.table1[this.field4] = place;
			this.field4 = place;
		} else {
			this.table2[place] = before;
			const first = this.table1[before] ?? END;
			this.table1[place] = first;
			this.table2[first] = place;
			this.table1[before] = place;
		}
	}

	/** `AbcDecoder.sub_411870`: the place of the picture standing of the place before it and a place of it. */
	private findPlace(previous: number, symbol: number): number {
		let token = this.dict2[previous] ?? END;
		while (token !== END && symbol !== this.root[token]) {
			token = this.dict3[token] ?? END;
		}
		return token;
	}

	/** `AbcDecoder.sub_4119E0`: a place of the picture standing of the place before it and a place of it. */
	private addPlace(previous: number, token: number, symbol: number): void {
		this.root[token] = symbol;
		this.dict1[token] = previous;
		this.dict2[token] = END;
		this.dict4[token] = END;
		const second = this.dict2[previous] ?? END;
		this.dict3[token] = second;
		if (END !== second) this.dict4[second] = token;
		this.dict2[previous] = token;
	}

	/** `AbcDecoder.sub_411A40`: the places of a table of the walks standing behind the place before them. */
	private dropPlace(place: number): void {
		const fourth = this.dict4[place] ?? END;
		const third = this.dict3[place] ?? END;
		if (END === fourth) {
			this.dict2[this.dict1[place] ?? END] = third;
		} else {
			this.dict3[fourth] = third;
		}
		if (END !== third) this.dict4[third] = fourth;
	}

	/** `AbcDecoder.sub_4118F0`: the places of the walks standing of the places just read. */
	private addWalks(
		source: number,
		count: number,
		previousToken: number,
		previousCount: number,
	): void {
		if (END === previousToken) return;
		for (let at = 0; at < count; at += 1) {
			previousCount += 1;
			if (previousCount > MAX_STRING) break;
			const symbol = this.buffer[source] ?? 0;
			let token = this.findPlace(previousToken, symbol);
			if (END === token) {
				token = this.lastToken;
				if (token >= END) {
					token = this.field8;
					if (previousToken === token) return;
					this.moveForward(this.field8);
					this.dropPlace(token);
				} else {
					this.lastToken = token + 1;
				}
				this.addPlace(previousToken, token, symbol);
				this.standBefore(
					token,
					previousToken >= FIRST_TOKEN
						? (this.table2[previousToken] ?? END)
						: this.field4,
				);
			}
			previousToken = token;
			source += 1;
		}
	}

	/** `AbcDecoder.Unpack`: the places of the picture, of the walks of the bits of the file. */
	unpack(output: Buffer): void {
		let previousCount = 0;
		let previousToken = END;
		let destination = 0;
		while (destination < output.length) {
			const current = this.readToken();
			let count = 0;
			let at = MAX_STRING;
			for (
				let token = current;
				token !== END;
				token = this.dict1[token] ?? END
			) {
				if (token >= FIRST_TOKEN && token !== this.field4) {
					this.moveForward(token);
					this.standBefore(token, this.field4);
				}
				// The reference reads its places into a buffer of a hundred of them and would stand beyond
				// the end of it where the walks of a picture name more places than that.
				at -= 1;
				if (at < 0) {
					throw invalidPicture(
						"The walks of the picture stand of more places than its picture may",
					);
				}
				this.buffer[at] = this.root[token] ?? 0;
				count += 1;
			}
			const source = MAX_STRING - count;
			const places = Math.min(count, output.length - destination);
			for (let place = 0; place < places; place += 1) {
				output[destination] = this.buffer[source + place] ?? 0;
				destination += 1;
			}
			if (destination >= output.length) break;
			this.addWalks(MAX_STRING - count, count, previousToken, previousCount);
			previousToken = current;
			previousCount = count;
		}
	}
}

/** `AbcDecoder` of the whole of the places of a picture. */
export function unpackAbc(data: Buffer, outputSize: number): Buffer {
	if (outputSize > LIMIT)
		throw invalidPicture("The picture stands of more places than it may");
	const output: Buffer = Buffer.alloc(outputSize, 0x00);
	new AbcDecoder(data).unpack(output);
	return output;
}

/** `AbcFormat.ReadMetaData`: the picture behind the walks of the engine, of the places of it. */
export function readAbcLayout(data: Buffer): AbcLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	const unpackedSize = data.readInt32LE(0);
	if (unpackedSize < MIN_UNPACKED_SIZE || unpackedSize > MAX_UNPACKED_SIZE) {
		return undefined;
	}
	const signature = data.readUInt32LE(4);
	if (
		(SIGNATURE_TAIL !== (signature & 0xffff) &&
			SIGNATURE_TEXTURE !== signature) ||
		data.length <= HEAD_SIZE
	) {
		return undefined;
	}
	const head = unpackAbc(data, Math.min(HEAD_PLACES, unpackedSize));
	if (head.subarray(0, BMP_MARK.length).equals(BMP_MARK)) {
		const info = readBmpMetaData(head);
		if (!info) return undefined;
		return {
			unpackedSize,
			width: info.width,
			height: info.height,
			bitsPerPixel: info.bitsPerPixel,
			kind: "bmp",
		};
	}
	if (head.subarray(0, DDS_MARK.length).equals(DDS_MARK)) {
		const texture = readDdsLayout(head);
		if (!texture) return undefined;
		return {
			unpackedSize,
			width: texture.width,
			height: texture.height,
			bitsPerPixel: texture.bitsPerPixel,
			kind: "dds",
		};
	}
	return undefined;
}

/** `AbcFormat.Read`: the picture behind the walks, handed over as the picture it stands of. */
export function unpackAbcPicture(data: Buffer, layout: AbcLayout): Buffer {
	const stored = unpackAbc(data, layout.unpackedSize);
	if ("bmp" === layout.kind) {
		const image = readBmpImage(stored);
		if (!image)
			throw invalidPicture("The picture behind the walks stands of no bitmap");
		return writeBmpImage(image);
	}
	const texture = readDdsLayout(stored);
	if (!texture)
		throw invalidPicture("The picture behind the walks stands of no texture");
	// The reader of a texture of the reference hands the picture of it over as the places of it read,
	// which a bitmap of this project records with a height of the other way up.
	return writeBmp32(
		texture.width,
		texture.height,
		readDdsPicture(stored, texture),
	);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const abcImageDescriptor: FormatDescriptor = {
	id: "sarang-abc-image",
	name: "Sarang compressed bitmap",
	extensions: ["abc"],
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
			source: "Legacy/Sarang/ImageABC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const abcImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: abcImageDescriptor,
	// The reference registers no signature of its own: the head of the picture is what decides.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readAbcLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readAbcLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Sarang engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					unpackedSize: layout.unpackedSize,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readAbcLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Sarang engine");
		return Readable.from([unpackAbcPicture(data, layout)]);
	},
});
