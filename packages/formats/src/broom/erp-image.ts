// Port of GARbro "Legacy/BRoom/ImageERP.cs" (tag "ERP", classes ErpFormat, ErpReader, ErpKey), GARbro
// commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. The walks of the engine stand of a key
// that steps on by a place of the key tables with every run of the places of the picture.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { copyOverlapped } from "../shared/copy.js";
import { writeBmp8Palette, writeBmp24 } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { ERP_FORMAT_KEY, ERP_HEAD_KEY, ERP_READER_KEY } from "./erp-tables.js";

const HEAD_SIZE = 0x14;
const SIGNATURE = 0x26594500;
const MAX_ID = 31;
const PALETTE_COLORS = 0x100;
/** The kind of the walks of a picture of a depth of eight places to a place stands of no method. */
const RUN_XOR = 9;
const COLOR_XOR = 13;
const COUNT_XOR = 0xe9;
/** The places of every colour of a place of the walks of the engine, of every kind of walk. */
const CHANNEL_ORDER: number[][] = [
	[0, 1, 2],
	[0, 2, 1],
	[1, 0, 2],
	[1, 2, 0],
	[2, 0, 1],
	[2, 1, 0],
];

export interface ErpLayout {
	id: number;
	method: number;
	keyIndex: number;
	bitsPerPixel: number;
	width: number;
	height: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function tableAt(
	table: number[][][],
	row: number,
	keyIndex: number,
	id: number,
): number {
	return table[row]?.[keyIndex]?.[id] ?? 0;
}

/** `ErpFormat.ReadMetaData`: the head of the picture, of the key of it. */
export function readErpLayout(data: Buffer): ErpLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if ((data.readUInt32LE(0) & 0xffffff00) >>> 0 !== SIGNATURE) return undefined;
	const header = Buffer.from(data.subarray(0, HEAD_SIZE));
	const id = (header[0] ?? 0) ^ (ERP_HEAD_KEY[0] ?? 0);
	if (id >= MAX_ID) return undefined;
	for (let at = 4; at < HEAD_SIZE; at += 1) {
		header[at] = (header[at] ?? 0) ^ (ERP_HEAD_KEY[at] ?? 0);
	}
	const method = header.readInt32LE(16) ^ id;
	if (method < 0 || method > 12) return undefined;
	// The place of the key tables the picture stands of: the reference stands of the place of the last
	// picture where it held, and this port asks after every picture.
	let keyIndex = -1;
	for (let at = 2; at >= 0; at -= 1) {
		const depth = (header[4] ?? 0) ^ tableAt(ERP_FORMAT_KEY, 0, at, id);
		if (8 === depth || 24 === depth) {
			keyIndex = at;
			break;
		}
	}
	if (keyIndex < 0) return undefined;
	const bitsPerPixel =
		header.readInt32LE(4) ^ tableAt(ERP_FORMAT_KEY, 0, keyIndex, id);
	if (8 !== bitsPerPixel && 24 !== bitsPerPixel) return undefined;
	const width =
		((header.readUInt32LE(8) ^ tableAt(ERP_FORMAT_KEY, 1, keyIndex, id)) *
			4) >>>
		0;
	const height =
		((header.readUInt32LE(12) ^ tableAt(ERP_FORMAT_KEY, 2, keyIndex, id)) *
			4) >>>
		0;
	if (0 === width || 0 === height) return undefined;
	return { id, method, keyIndex, bitsPerPixel, width, height };
}

/** `ErpKey`: the place of a key, of the places of the key before it. */
class ErpKey {
	private value: number;

	constructor(
		value: number,
		private readonly step: number,
	) {
		this.value = value;
	}

	get byteValue(): number {
		return this.value & 0xff;
	}

	next(): void {
		this.value += this.step;
		if (this.value > 0xff) this.value -= 0xff;
	}
}

/** `ErpReader.Unpack8bpp`: the places of a picture of eight places, of a run of the colours of it. */
function unpack8bpp(data: Buffer, layout: ErpLayout): Buffer {
	const output: Buffer = Buffer.alloc(layout.width * layout.height, 0x00);
	let at = HEAD_SIZE + PALETTE_COLORS * 4;
	let destination = 0;
	while (destination < output.length && at < data.length) {
		const place = data[at] ?? 0;
		let count = data[at + 1] ?? -1;
		at += 2;
		if (count < 0) break;
		count ^= RUN_XOR;
		if (count > 0) {
			const value = place ^ COLOR_XOR;
			for (let step = 0; step < count; step += 1) {
				output[destination] = value;
				destination += 1;
			}
		}
	}
	return output;
}

/** `ErpReader.UnpackV0`: the places of a picture, of a run of the colours of it. */
function unpackV0(data: Buffer, layout: ErpLayout): Buffer {
	const { id, keyIndex } = layout;
	const output: Buffer = Buffer.alloc(layout.width * 3 * layout.height, 0x00);
	const countKey = new ErpKey(
		id ^ 0x68,
		tableAt(ERP_READER_KEY, 6, keyIndex, id),
	);
	const redKey = new ErpKey(
		tableAt(ERP_READER_KEY, 0, keyIndex, id),
		tableAt(ERP_READER_KEY, 3, keyIndex, id),
	);
	const greenKey = new ErpKey(
		tableAt(ERP_READER_KEY, 1, keyIndex, id),
		tableAt(ERP_READER_KEY, 4, keyIndex, id),
	);
	const blueKey = new ErpKey(
		tableAt(ERP_READER_KEY, 2, keyIndex, id),
		tableAt(ERP_READER_KEY, 5, keyIndex, id),
	);
	let at = HEAD_SIZE;
	let destination = 0;
	while (destination < output.length && at + 4 <= data.length) {
		const blue = (data[at] ?? 0) ^ blueKey.byteValue;
		const green = (data[at + 1] ?? 0) ^ greenKey.byteValue;
		const red = (data[at + 2] ?? 0) ^ redKey.byteValue;
		at += 3;
		let count = data[at] ?? -1;
		at += 1;
		if (count < 0) break;
		count ^= countKey.byteValue ^ COUNT_XOR;
		if (count > 0) {
			output[destination] = blue;
			output[destination + 1] = green;
			output[destination + 2] = red;
			destination += 3;
			const places = Math.min((count - 1) * 3, output.length - destination);
			if (places > 0) {
				copyOverlapped(output, destination - 3, destination, places);
				destination += places;
			}
		}
		redKey.next();
		greenKey.next();
		blueKey.next();
		countKey.next();
	}
	return output;
}

/** `ErpReader.UnpackV1`: the places of a picture, of the runs of every colour of it. */
function unpackV1(data: Buffer, layout: ErpLayout): Buffer {
	const { id, keyIndex, method } = layout;
	const output: Buffer = Buffer.alloc(layout.width * 3 * layout.height, 0x00);
	const counts: number[] = [];
	const countKey = new ErpKey(
		id ^ 0x68,
		tableAt(ERP_READER_KEY, 6, keyIndex, id),
	);
	let at = HEAD_SIZE;
	for (;;) {
		if (at >= data.length) break;
		let count = data[at] ?? 0;
		at += 1;
		count ^= countKey.byteValue ^ COUNT_XOR;
		if (0 === count) break;
		counts.push(count);
		countKey.next();
	}
	const order = CHANNEL_ORDER[method - 1] ?? [];
	for (const channel of order) {
		const pixelKey = new ErpKey(
			tableAt(ERP_READER_KEY, channel, keyIndex, id),
			tableAt(ERP_READER_KEY, channel + 3, keyIndex, id),
		);
		let destination = 2 - channel;
		for (const count of counts) {
			const value = (data[at] ?? 0) ^ pixelKey.byteValue;
			at += 1;
			for (let step = 0; step < count; step += 1) {
				if (destination < output.length) output[destination] = value;
				destination += 3;
			}
			pixelKey.next();
		}
	}
	return output;
}

/** `ErpReader.UnpackChannel`: the places of one colour of a picture, of the runs of it. */
function unpackChannel(
	data: Buffer,
	layout: ErpLayout,
	channel: number,
	at: number,
): { places: Buffer; at: number } {
	const { id, keyIndex } = layout;
	const places: Buffer = Buffer.alloc(
		(layout.width * 3 * layout.height) / 3,
		0x00,
	);
	const countKey = new ErpKey(
		id ^ 0x68,
		tableAt(ERP_READER_KEY, 6, keyIndex, id),
	);
	const pixelKey = new ErpKey(
		tableAt(ERP_READER_KEY, channel, keyIndex, id),
		tableAt(ERP_READER_KEY, channel + 3, keyIndex, id),
	);
	let destination = 0;
	for (;;) {
		if (at + 2 > data.length) break;
		const place = data[at] ?? 0;
		let count = data[at + 1] ?? 0;
		at += 2;
		count ^= countKey.byteValue ^ COUNT_XOR;
		if (0 === count) break;
		count = Math.min(count, places.length - destination);
		const value = place ^ pixelKey.byteValue;
		for (let step = 0; step < count; step += 1) {
			places[destination] = value;
			destination += 1;
		}
		countKey.next();
		pixelKey.next();
	}
	return { places, at };
}

/** `ErpReader.UnpackV7`: the places of a picture, of the runs of every colour of it behind one another. */
function unpackV7(data: Buffer, layout: ErpLayout): Buffer {
	const order = CHANNEL_ORDER[layout.method - 7] ?? [];
	const channels: Buffer[] = [];
	let at = HEAD_SIZE;
	for (const channel of order) {
		const result = unpackChannel(data, layout, channel, at);
		channels[channel] = result.places;
		at = result.at;
	}
	const output: Buffer = Buffer.alloc(layout.width * 3 * layout.height, 0x00);
	const places = output.length / 3;
	for (let place = 0; place < places; place += 1) {
		output[place * 3] = channels[2]?.[place] ?? 0;
		output[place * 3 + 1] = channels[1]?.[place] ?? 0;
		output[place * 3 + 2] = channels[0]?.[place] ?? 0;
	}
	return output;
}

/** `ErpFormat.Read`: the places of the picture, handed over as a bitmap. */
export function unpackErpPicture(data: Buffer, layout: ErpLayout): Buffer {
	if (8 === layout.bitsPerPixel) {
		if (HEAD_SIZE + PALETTE_COLORS * 4 > data.length) {
			throw invalidPicture(
				"The colours of the picture stand short of the file",
			);
		}
		const palette: Buffer = Buffer.alloc(PALETTE_COLORS * 4, 0x00);
		data.copy(palette, 0, HEAD_SIZE, HEAD_SIZE + PALETTE_COLORS * 4);
		return writeBmp8Palette(
			layout.width,
			layout.height,
			unpack8bpp(data, layout),
			palette,
		);
	}
	const places =
		0 === layout.method
			? unpackV0(data, layout)
			: layout.method < 7
				? unpackV1(data, layout)
				: unpackV7(data, layout);
	return writeBmp24(layout.width, layout.height, places);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const broomErpImageDescriptor: FormatDescriptor = {
	id: "broom-erp-image",
	name: "Studio B-Room image",
	extensions: ["erp"],
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
			source: "Legacy/BRoom/ImageERP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const broomErpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: broomErpImageDescriptor,
	// The reference stands of no word of its own: the first place of the head names the key of it.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readErpLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const layout = readErpLayout(await readStored(source));
		if (!layout)
			throw invalidPicture("Not a picture of the Studio B-Room engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: 0n,
				size: source.size,
				compressed: true,
				encrypted: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					method: layout.method,
					keyIndex: layout.keyIndex,
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
		const layout = readErpLayout(data);
		if (!layout)
			throw invalidPicture("Not a picture of the Studio B-Room engine");
		return Readable.from([unpackErpPicture(data, layout)]);
	},
});
