import { BufferByteSource } from "@garbro-mcp/core";
import { inflateKaguyaLz, kaguyaAriFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";

const SIGNATURE = "WFL1";
const MODE_PACKED = 1;
const MODE_AUDIO = 2;

interface Spec {
	name: string;
	payload: Buffer;
	plain: Buffer;
	mode: number;
}

/** Writes msb first control bits, mirroring the frame walk of the reader. */
class KaguyaLzWriter {
	readonly #bits: number[] = [];

	#push(value: number, count: number): void {
		for (let shift = count - 1; shift >= 0; shift -= 1)
			this.#bits.push((value >> shift) & 1);
	}

	literal(value: number): void {
		this.#push(1, 1);
		this.#push(value, 8);
	}

	copy(windowOffset: number, count: number): void {
		this.#push(0, 1);
		this.#push(windowOffset, 12);
		this.#push(count - 2, 4);
	}

	finish(): Buffer {
		const bytes = Buffer.alloc(Math.ceil(this.#bits.length / 8));
		for (const [index, bit] of this.#bits.entries()) {
			if (bit === 0) continue;
			const at = Math.floor(index / 8);
			bytes[at] = (bytes[at] ?? 0) | (0x80 >> (index % 8));
		}
		return bytes;
	}
}

function encryptName(name: string): Buffer {
	const bytes = Buffer.from(name, "latin1");
	for (let index = 0; index < bytes.length; index += 1)
		bytes[index] = (bytes[index] ?? 0) ^ 0xff;
	return bytes;
}

/** Packs an entry with literals only, which is the simplest stream the reader accepts. */
function packPayload(plain: Buffer): Buffer {
	const writer = new KaguyaLzWriter();
	for (const byte of plain) writer.literal(byte);
	return writer.finish();
}

function record(spec: Spec, includeUnpacked: boolean): Buffer {
	const name = encryptName(spec.name);
	const header = Buffer.alloc(4 + name.length + 2 + 4);
	header.writeInt32LE(name.length, 0);
	name.copy(header, 4);
	const at = 4 + name.length;
	header.writeUInt16LE(spec.mode, at);
	header.writeUInt32LE(spec.payload.length, at + 2);
	const parts: Buffer[] = [header];
	if (spec.mode === MODE_PACKED && includeUnpacked) {
		const size = Buffer.alloc(4);
		size.writeUInt32LE(spec.plain.length, 0);
		parts.push(size);
	}
	parts.push(spec.payload);
	return Buffer.concat(parts);
}

function buildInline(specs: readonly Spec[]): Buffer {
	return Buffer.concat([
		Buffer.from(SIGNATURE, "latin1"),
		...specs.map((spec) => record(spec, true)),
	]);
}

/** The archive keeps its inline table; the side index only repeats the record table without the sizes. */
function buildSideArchive(specs: readonly Spec[]): Buffer {
	return buildInline(specs);
}

function buildSideIndex(specs: readonly Spec[]): Buffer {
	return Buffer.concat(specs.map((spec) => record(spec, false)));
}

describe("KaGuYa script engine resource archive", () => {
	it("reads an inline index with stored and packed entries", async () => {
		const stored = Buffer.from("stored payload");
		const plain = Buffer.from("packed payload contents");
		await expectArchive({
			format: kaguyaAriFormat,
			sourcePath: "data.arc",
			archive: buildInline([
				{ name: "stored.dat", payload: stored, plain: stored, mode: 0 },
				{
					name: "packed.dat",
					payload: packPayload(plain),
					plain,
					mode: MODE_PACKED,
				},
			]),
			entries: [
				{ path: "stored.dat", size: stored.length, content: stored },
				{ path: "packed.dat", size: plain.length, content: plain },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("reads a side index", async () => {
		const stored = Buffer.from("side stored payload");
		const plain = Buffer.from("side packed payload");
		const specs: Spec[] = [
			{ name: "first.dat", payload: stored, plain: stored, mode: 0 },
			{
				name: "second.dat",
				payload: packPayload(plain),
				plain,
				mode: MODE_PACKED,
			},
		];
		await withCompanionFiles(
			"data.arc",
			{
				"data.arc": buildSideArchive(specs),
				"data.ari": buildSideIndex(specs),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: kaguyaAriFormat,
					mainPath,
					entries: [
						{ path: "first.dat", size: stored.length, content: stored },
						{ path: "second.dat", size: plain.length, content: plain },
					],
					metadata: { entryCount: 2 },
				});
			},
		);
	});

	it("strips the leading separator of a name", async () => {
		const payload = Buffer.from("payload");
		await expectArchive({
			format: kaguyaAriFormat,
			sourcePath: "data.arc",
			archive: buildInline([
				{ name: "\\scene\\part.dat", payload, plain: payload, mode: 0 },
			]),
			entries: [
				{ path: "scene/part.dat", size: payload.length, content: payload },
			],
		});
	});

	it("types entries by their mode and extension", async () => {
		const audio = Buffer.from("audio payload");
		const image = Buffer.from("image payload");
		const ogg = Buffer.from("ogg payload");
		const archive = await kaguyaAriFormat.open(
			new BufferByteSource(
				buildInline([
					{ name: "voice.dat", payload: audio, plain: audio, mode: MODE_AUDIO },
					{
						name: "face.dat",
						payload: packPayload(image),
						plain: image,
						mode: MODE_PACKED,
					},
					{ name: "music.ogg", payload: ogg, plain: ogg, mode: 0 },
				]),
			),
			"data.arc",
		);
		expect(archive.entries.map((entry) => entry.metadata?.type)).toEqual([
			"audio",
			"image",
			"audio",
		]);
	});

	it("copies from the frame with an overlap", () => {
		const writer = new KaguyaLzWriter();
		writer.literal(0x61);
		writer.copy(1, 3);
		expect(inflateKaguyaLz(writer.finish(), 4).toString("latin1")).toBe("aaaa");
	});

	it("rejects a foreign signature", async () => {
		const file = buildInline([
			{
				name: "stored.dat",
				payload: Buffer.from("payload"),
				plain: Buffer.from("payload"),
				mode: 0,
			},
		]);
		file.write("WFL2", 0, "latin1");
		expect(
			await kaguyaAriFormat.detect(new BufferByteSource(file), "a.arc"),
		).toBe(false);
	});

	it("rejects a name length outside the index", async () => {
		const file = buildInline([
			{
				name: "stored.dat",
				payload: Buffer.from("payload"),
				plain: Buffer.from("payload"),
				mode: 0,
			},
		]);
		file.writeInt32LE(0x200, 4);
		expect(
			await kaguyaAriFormat.detect(new BufferByteSource(file), "a.arc"),
		).toBe(false);
	});

	it("rejects an entry that leaves the archive", async () => {
		const file = buildInline([
			{
				name: "stored.dat",
				payload: Buffer.from("payload"),
				plain: Buffer.from("payload"),
				mode: 0,
			},
		]);
		file.writeUInt32LE(0x1000, 4 + 4 + "stored.dat".length + 2);
		expect(
			await kaguyaAriFormat.detect(new BufferByteSource(file), "a.arc"),
		).toBe(false);
	});
});
