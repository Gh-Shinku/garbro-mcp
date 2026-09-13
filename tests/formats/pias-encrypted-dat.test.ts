import { FileByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	piasEncryptedDescriptor,
	piasEncryptedFormat,
} from "../../packages/formats/src/pias/encrypted-graph.js";
import { withCompanionFiles } from "../helpers/companion.js";

/** The graph key constants, mirroring `KeyGenerator` with type zero. */
const GRAPH_KEY = { x: 0xd22, y: 0x849 };
/** The text key constants, mirroring `KeyGenerator` with type one. */
const TEXT_KEY = { x: 0xf43, y: 0x356b };

function keyStream(
	count: number,
	seed: number,
	parameters: { x: number; y: number },
): number[] {
	const stream: number[] = [];
	let state = seed >>> 0;
	for (let index = 0; index < count; index += 1) {
		const value = (parameters.x + state * parameters.y) >>> 0;
		const feedback = ((value >>> 22) & 1) ^ ((value >>> 10) & 1) ^ (value & 1);
		state = ((value >>> 1) | (feedback << 31)) >>> 0;
		stream.push(state & 0xff);
	}
	return stream;
}

/** Applies the key stream from its first byte, which is what the reader does. */
function applyKey(
	data: Buffer,
	seed: number,
	parameters: { x: number; y: number },
): Buffer {
	const stream = keyStream(data.length, seed, parameters);
	const output = Buffer.from(data);
	for (let index = 0; index < output.length; index += 1)
		output[index] = (output[index] ?? 0) ^ (stream[index] ?? 0);
	return output;
}

/** Encodes an integer the way `TextReader.ReadInt` reads short values. */
function packedInt(value: number): Buffer {
	if (value < 0x40) return Buffer.from([value]);
	const data = Buffer.alloc(2);
	data.writeUInt16BE(value | 0x4000, 0);
	return data;
}

/** Builds an encrypted or plain text.dat list. */
function buildTextDat(
	records: { type: number; offsets: number[] }[],
	options: { signature?: number; encrypt?: boolean } = {},
): Buffer {
	const parts: Buffer[] = [];
	for (const record of records) {
		const header = Buffer.concat([
			Buffer.from([0x68]),
			packedInt(record.type),
			packedInt(record.offsets.length),
		]);
		const offsets = Buffer.alloc(record.offsets.length * 4);
		for (const [index, offset] of record.offsets.entries())
			offsets.writeUInt32LE(offset, index * 4);
		parts.push(Buffer.concat([header, offsets]));
	}
	const body = Buffer.concat(parts);
	if (options.encrypt === false) return body;
	const signature = options.signature ?? 0x02f3a62b;
	const head = Buffer.alloc(4);
	head.writeUInt32LE(signature >>> 0, 0);
	return Buffer.concat([head, applyKey(body, signature, TEXT_KEY)]);
}

interface GraphEntry {
	seed: number;
	payload: Buffer;
}

/**
 * Builds a graph.dat chain: every record is a seed word followed by the encrypted span of `size`
 * bytes, so the chain advances by the size plus the four seed bytes.
 */
function buildGraph(entries: GraphEntry[]): {
	file: Buffer;
	offsets: number[];
} {
	const parts: Buffer[] = [];
	const offsets: number[] = [];
	let offset = 0;
	for (const entry of entries) {
		offsets.push(offset);
		const size = entry.payload.length + 8;
		const span = Buffer.alloc(size);
		span.writeUInt32LE(entry.payload.length, 0);
		entry.payload.copy(span, 4);
		// The filler bytes belong to the encrypted span and are consumed with it.
		span.fill(0x5a, 4 + entry.payload.length);
		const record = Buffer.concat([
			Buffer.from([
				entry.seed & 0xff,
				(entry.seed >>> 8) & 0xff,
				(entry.seed >>> 16) & 0xff,
				(entry.seed >>> 24) & 0xff,
			]),
			applyKey(span, entry.seed, GRAPH_KEY),
		]);
		parts.push(record);
		offset += size + 4;
	}
	return { file: Buffer.concat(parts), offsets };
}

/** Builds a sound.dat chain of length prefixed payloads. */
function buildSound(payloads: Buffer[]): { file: Buffer; offsets: number[] } {
	const parts: Buffer[] = [];
	const offsets: number[] = [];
	let offset = 0;
	for (const payload of payloads) {
		offsets.push(offset);
		const header = Buffer.alloc(4);
		header.writeUInt32LE(payload.length, 0);
		parts.push(Buffer.concat([header, payload]));
		offset += payload.length + 4;
	}
	return { file: Buffer.concat(parts), offsets };
}

describe("pias encrypted dat", () => {
	it("lists encrypted graph entries and decrypts them", async () => {
		const first = {
			seed: 0x12345678,
			payload: Buffer.from("first graph payload"),
		};
		const second = { seed: 0x0fedcba9, payload: Buffer.from("second") };
		const scanned = { seed: 0x24681357, payload: Buffer.from("scan only") };
		const graph = buildGraph([first, second, scanned]);
		await withCompanionFiles(
			"graph.dat",
			{
				"graph.dat": graph.file,
				"text.dat": buildTextDat([
					{ type: 1, offsets: graph.offsets.slice(0, 2) },
				]),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await piasEncryptedFormat.detect(source, mainPath)).toBe(true);
					const archive = await piasEncryptedFormat.open(source, mainPath);
					try {
						expect(archive.entries.map((entry) => entry.path)).toEqual([
							"0000",
							"0001",
							"00000049_",
						]);
						expect(archive.entries.map((entry) => Number(entry.size))).toEqual([
							first.payload.length + 8,
							second.payload.length + 8,
							scanned.payload.length + 8,
						]);
						expect(archive.entries[2]?.metadata).toMatchObject({
							type: "image",
						});
						expect(archive.metadata).toMatchObject({ encrypted: true });
						const entry = archive.entries[0];
						if (!entry) throw new Error("missing entry");
						const output = await consumeBuffer(
							await archive.openEntry(entry.id),
						);
						expect(output.length).toBe(first.payload.length + 8);
						// The span starts with the size word and continues with the payload.
						expect(output.readUInt32LE(0)).toBe(first.payload.length);
						expect(output.subarray(4, 4 + first.payload.length)).toEqual(
							first.payload,
						);
					} finally {
						await archive.close();
					}
				} finally {
					await source.close();
				}
			},
		);
	});

	it("declines a text list with an unknown signature", async () => {
		const graph = buildGraph([{ seed: 1, payload: Buffer.from("data") }]);
		await withCompanionFiles(
			"graph.dat",
			{
				"graph.dat": graph.file,
				"text.dat": buildTextDat([{ type: 1, offsets: graph.offsets }], {
					signature: 0x12345678,
				}),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await piasEncryptedFormat.detect(source, mainPath)).toBe(
						false,
					);
				} finally {
					await source.close();
				}
			},
		);
	});

	it("declines a graph archive without a text list", async () => {
		const graph = buildGraph([{ seed: 1, payload: Buffer.from("data") }]);
		await withCompanionFiles(
			"graph.dat",
			{ "graph.dat": graph.file },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await piasEncryptedFormat.detect(source, mainPath)).toBe(
						false,
					);
				} finally {
					await source.close();
				}
			},
		);
	});

	it("wraps encrypted sound entries in a stereo riff header", async () => {
		const payload = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
		const sound = buildSound([payload]);
		await withCompanionFiles(
			"sound.dat",
			{
				"sound.dat": sound.file,
				"text.dat": buildTextDat([{ type: 2, offsets: sound.offsets }]),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					const archive = await piasEncryptedFormat.open(source, mainPath);
					try {
						expect(archive.metadata).toMatchObject({ encrypted: false });
						const entry = archive.entries[0];
						if (!entry) throw new Error("missing entry");
						expect(entry.metadata).toMatchObject({ type: "audio" });
						const output = await consumeBuffer(
							await archive.openEntry(entry.id),
						);
						expect(output.length).toBe(44 + payload.length);
						expect(output.toString("latin1", 0, 4)).toBe("RIFF");
						expect(output.readUInt16LE(0x16)).toBe(2);
						expect(output.readUInt32LE(0x18)).toBe(22050);
						expect(output.readUInt32LE(0x1c)).toBe(88200);
						expect(output.readUInt16LE(0x20)).toBe(4);
						expect(output.readUInt16LE(0x22)).toBe(16);
						expect(output.subarray(44)).toEqual(payload);
					} finally {
						await archive.close();
					}
				} finally {
					await source.close();
				}
			},
		);
	});

	it("declines archives the flavour does not serve", async () => {
		const sound = buildSound([Buffer.from("x")]);
		await withCompanionFiles(
			"voice.dat",
			{
				"voice.dat": sound.file,
				"text.dat": buildTextDat([{ type: 2, offsets: sound.offsets }]),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await piasEncryptedFormat.detect(source, mainPath)).toBe(
						false,
					);
				} finally {
					await source.close();
				}
			},
		);
	});

	it("declares the encrypted text signatures", () => {
		expect(piasEncryptedDescriptor.id).toBe("pias-encrypted-dat");
		expect(piasEncryptedFormat.detection?.signatures?.length).toBe(2);
		expect(piasEncryptedFormat.detection?.signatures?.[0]?.bytes).toEqual(
			Buffer.from([0x2b, 0xa6, 0xf3, 0x02]),
		);
	});
});
