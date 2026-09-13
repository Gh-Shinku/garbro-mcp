import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { willArc2Format } from "../../packages/formats/src/will/arc2.js";
import { expectArchive } from "../helpers/archive.js";

/** Collects the operations of a PSP stream, packing the control bits least significant first. */
class PspWriter {
	private readonly frame = Buffer.alloc(0x1000);
	private framePos = 1;
	private readonly output: number[] = [];
	/** One entry per operation: the control bit and the payload bytes it reads. */
	private readonly ops: { bit: number; payload: number[] }[] = [];

	literal(value: number): this {
		const byte = value & 0xff;
		this.ops.push({ bit: 1, payload: [byte] });
		this.write(byte);
		return this;
	}

	/** Copies `count` bytes from an absolute frame index. */
	match(source: number, count: number): this {
		this.ops.push({
			bit: 0,
			payload: [(source >> 4) & 0xff, ((source & 0x0f) << 4) | (count - 2)],
		});
		let from = source;
		for (let i = 0; i < count; i += 1) {
			this.write(this.frame[from & 0xfff] ?? 0);
			from += 1;
		}
		return this;
	}

	private write(value: number): void {
		this.frame[this.framePos & 0xfff] = value;
		this.framePos += 1;
		this.output.push(value);
	}

	build(): { stream: Buffer; output: Buffer } {
		const parts: Buffer[] = [];
		// A control byte is followed by the payload of the operations it describes.
		for (let group = 0; group * 8 < this.ops.length; group += 1) {
			let control = 0;
			const payload: number[] = [];
			for (let bit = 0; bit < 8; bit += 1) {
				const op = this.ops[group * 8 + bit];
				if (!op) break;
				if (op.bit === 1) control |= 1 << bit;
				payload.push(...op.payload);
			}
			parts.push(Buffer.from([control]), Buffer.from(payload));
		}
		const header = Buffer.alloc(4);
		header.writeInt32LE(this.output.length, 0);
		return {
			stream: Buffer.concat([header, ...parts]),
			output: Buffer.from(this.output),
		};
	}
}

function rotateLeft2(value: number): number {
	return (((value << 2) | (value >>> 6)) & 0xff) >>> 0;
}

interface FixtureEntry {
	name: string;
	/** Stored bytes. */
	data: Buffer;
	/** Extracted bytes, which differ from the stored bytes for script and PSP entries. */
	plain?: Buffer;
}

interface FixtureOptions {
	entries: FixtureEntry[];
	countDelta?: number;
	indexSizeOverride?: number;
	indexPadding?: number;
	rawOffsets?: number[];
	emptyName?: boolean;
}

/** Builds a Will v2 archive whose payloads start right after the index. */
function buildArc2(options: FixtureOptions): Buffer {
	const names: Buffer[] = [];
	const payloads: Buffer[] = [];
	const sizes: number[] = [];
	for (const entry of options.entries) {
		const nameParts: number[] = [];
		for (const character of options.emptyName ? "" : entry.name)
			nameParts.push(character.charCodeAt(0));
		const name = Buffer.alloc((nameParts.length + 1) * 2);
		for (const [index, unit] of nameParts.entries())
			name.writeUInt16LE(unit, index * 2);
		names.push(name);
		payloads.push(entry.data);
		sizes.push(entry.data.length);
	}
	const padding = Buffer.alloc(options.indexPadding ?? 0);
	// Records and names are interleaved: each record is followed by its own name.
	const indexSize =
		names.reduce((total, name) => total + 8 + name.length, 0) + padding.length;
	const baseOffset = 8 + indexSize;
	const offsets: number[] = [];
	let payloadCursor = baseOffset;
	const indexParts: Buffer[] = [];
	for (const [number, name] of names.entries()) {
		const stored = payloads[number]?.length ?? 0;
		const raw = options.rawOffsets?.[number];
		const record = Buffer.alloc(8);
		record.writeUInt32LE(sizes[number] ?? 0, 0);
		record.writeUInt32LE(raw ?? payloadCursor - baseOffset, 4);
		offsets.push(payloadCursor);
		payloadCursor += stored;
		indexParts.push(record, name);
	}
	indexParts.push(padding);
	const index = Buffer.concat(indexParts);
	const file = Buffer.alloc(Math.max(payloadCursor, baseOffset));
	file.writeInt32LE(options.entries.length + (options.countDelta ?? 0), 0);
	file.writeUInt32LE((options.indexSizeOverride ?? indexSize) >>> 0, 4);
	index.copy(file, 8);
	for (const [number, payload] of payloads.entries())
		payload.copy(file, offsets[number] ?? 0);
	return file;
}

function sourceOf(archive: Buffer): BufferByteSource {
	return new BufferByteSource(archive);
}

describe("will AR2", () => {
	it("detects an index whose records fill the index exactly", async () => {
		const built = buildArc2({
			entries: [{ name: "A.TXT", data: Buffer.from("body") }],
		});
		expect(await willArc2Format.detect(sourceOf(built), "TEST.ARC")).toBe(true);
	});

	it("declines a file with an insane entry count", async () => {
		const built = buildArc2({
			entries: [{ name: "A.TXT", data: Buffer.from("body") }],
			countDelta: 0x100000,
		});
		expect(await willArc2Format.detect(sourceOf(built), "TEST.ARC")).toBe(
			false,
		);
	});

	it("declines an index size that runs past the payload base", async () => {
		const built = buildArc2({
			entries: [{ name: "A.TXT", data: Buffer.from("body") }],
			indexSizeOverride: 0xfffffff0,
		});
		expect(await willArc2Format.detect(sourceOf(built), "TEST.ARC")).toBe(
			false,
		);
	});

	it("declines an index that is not consumed exactly", async () => {
		const built = buildArc2({
			entries: [{ name: "A.TXT", data: Buffer.from("body") }],
			indexPadding: 4,
		});
		expect(await willArc2Format.detect(sourceOf(built), "TEST.ARC")).toBe(
			false,
		);
	});

	it("declines an entry that points past the end of the archive", async () => {
		const built = buildArc2({
			entries: [{ name: "A.TXT", data: Buffer.from("body") }],
			rawOffsets: [0x100000],
		});
		expect(await willArc2Format.detect(sourceOf(built), "TEST.ARC")).toBe(
			false,
		);
	});

	it("declines a record with an empty name", async () => {
		const built = buildArc2({
			entries: [{ name: "A.TXT", data: Buffer.from("body") }],
			emptyName: true,
		});
		expect(await willArc2Format.detect(sourceOf(built), "TEST.ARC")).toBe(
			false,
		);
	});

	it("reads UTF-16 names", async () => {
		const built = buildArc2({
			entries: [
				{ name: "NAME.TXT", data: Buffer.from("first") },
				{ name: "\u540d\u524d.TXT", data: Buffer.from("second") },
			],
		});
		await expectArchive({
			format: willArc2Format,
			archive: built,
			entries: [
				{ path: "NAME.TXT", size: 5, content: Buffer.from("first") },
				{ path: "\u540d\u524d.TXT", size: 6, content: Buffer.from("second") },
			],
		});
	});

	it("leaves ordinary entries alone", async () => {
		const built = buildArc2({
			entries: [{ name: "DATA.BIN", data: Buffer.from("raw bytes") }],
		});
		await expectArchive({
			format: willArc2Format,
			archive: built,
			entries: [
				{ path: "DATA.BIN", size: 9, content: Buffer.from("raw bytes") },
			],
		});
	});

	it("rotates script entries on extraction", async () => {
		// The writer stores scripts rotated the other way, so extraction undoes the rotation.
		const plain = Buffer.from("script text");
		const stored = Buffer.from(plain);
		for (let i = 0; i < stored.length; i += 1)
			stored[i] = rotateLeft2(stored[i] ?? 0) & 0xff;
		const built = buildArc2({
			entries: [{ name: "MAIN.WS2", data: stored, plain }],
		});
		await expectArchive({
			format: willArc2Format,
			archive: built,
			entries: [{ path: "MAIN.WS2", size: plain.length, content: plain }],
		});
	});

	it("treats json files as scripts as well", async () => {
		const plain = Buffer.from('{"a":1}');
		const stored = Buffer.from(plain);
		for (let i = 0; i < stored.length; i += 1)
			stored[i] = rotateLeft2(stored[i] ?? 0) & 0xff;
		const built = buildArc2({
			entries: [{ name: "DATA.JSON", data: stored, plain }],
		});
		await expectArchive({
			format: willArc2Format,
			archive: built,
			entries: [{ path: "DATA.JSON", size: plain.length, content: plain }],
		});
	});

	it("skips the script rotation for model archives", async () => {
		const plain = Buffer.from("script text");
		const stored = Buffer.from(plain);
		for (let i = 0; i < stored.length; i += 1)
			stored[i] = rotateLeft2(stored[i] ?? 0) & 0xff;
		const built = buildArc2({
			entries: [{ name: "MAIN.WS2", data: stored, plain }],
		});
		// The reference looks for "Model" in the archive file name.
		await expectArchive({
			format: willArc2Format,
			archive: built,
			sourcePath: "GameModel.ARC",
			entries: [{ path: "MAIN.WS2", size: stored.length, content: stored }],
		});
	});

	it("unpacks literal only psp streams", async () => {
		const writer = new PspWriter();
		for (const byte of Buffer.from("literal stream")) writer.literal(byte);
		const { stream, output } = writer.build();
		const built = buildArc2({
			entries: [{ name: "IMG.PSP", data: stream, plain: output }],
		});
		await expectArchive({
			format: willArc2Format,
			archive: built,
			entries: [{ path: "IMG.PSP", size: stream.length, content: output }],
		});
	});

	it("copies psp matches from the ring buffer", async () => {
		const writer = new PspWriter();
		writer.literal(0x41);
		writer.literal(0x42);
		writer.literal(0x43);
		// The literals land in frame slots one to three, so a match from slot one repeats them.
		writer.match(1, 2);
		const { stream, output } = writer.build();
		expect(output).toEqual(Buffer.from("ABCAB"));
		const built = buildArc2({
			entries: [{ name: "IMG.PSP", data: stream, plain: output }],
		});
		await expectArchive({
			format: willArc2Format,
			archive: built,
			// The declared size is the stored stream; the unpacked size comes from the stream header.
			entries: [{ path: "IMG.PSP", size: stream.length, content: output }],
		});
	});

	it("marks psp entries as compressed with a size from the stream", async () => {
		const writer = new PspWriter();
		for (const byte of Buffer.from("payload")) writer.literal(byte);
		const { stream } = writer.build();
		const built = buildArc2({ entries: [{ name: "IMG.PSP", data: stream }] });
		const archive = await willArc2Format.open(sourceOf(built), "TEST.ARC");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect({
				size: entry.size,
				packedSize: entry.packedSize,
				compressed: entry.compressed,
				sizeKnown: entry.sizeKnown !== false,
			}).toEqual({
				// The entry declares the stored stream size and flags the real size as unknown.
				size: BigInt(stream.length),
				packedSize: BigInt(stream.length),
				compressed: true,
				sizeKnown: false,
			});
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.from("payload"),
			);
		} finally {
			await archive.close();
		}
	});

	it("rejects a truncated psp stream", async () => {
		const writer = new PspWriter();
		for (const byte of Buffer.from("payload")) writer.literal(byte);
		const { stream } = writer.build();
		const built = buildArc2({
			entries: [{ name: "IMG.PSP", data: stream.subarray(0, 7) }],
		});
		const archive = await willArc2Format.open(sourceOf(built), "TEST.ARC");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(
				(async () => consumeBuffer(await archive.openEntry(entry.id)))(),
			).rejects.toThrow(/Invalid PSP stream/);
		} finally {
			await archive.close();
		}
	});
});
