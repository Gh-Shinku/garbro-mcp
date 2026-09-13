import { BufferByteSource } from "@garbro-mcp/core";
import { kaguyaLin2Format } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

interface Entry {
	name: string;
	content: Buffer;
	/** The index's stored payload; defaults to the content. */
	stored?: Buffer;
	/** The record's type word. */
	type?: number;
}

/** Masks a name field the way the reference unmasks it. */
function maskName(name: string): Buffer {
	const field = Buffer.from(name, "latin1");
	for (let position = 0; position < field.length; position += 1)
		field[position] = (field[position] ?? 0) ^ 0xff;
	return field;
}

/**
 * Builds the format's LZSS stream. Control bits are read most significant first, and a match consumes an
 * offset byte plus a count nibble. The reference shares one count byte between two consecutive matches,
 * which this helper refuses to emit.
 */
function buildLin2Stream(
	commands: readonly (number | readonly [number, number])[],
): Buffer {
	const bytes: number[] = [];
	// Commands are consumed in groups of at most eight, one control bit each.
	let index = 0;
	let sawMatch = false;
	while (index < commands.length) {
		let control = 0;
		let bit = 0x80;
		const payload: number[] = [];
		for (let used = 0; used < 8 && index < commands.length; used += 1) {
			const command = commands[index];
			index += 1;
			if (command === undefined) break;
			if (typeof command === "number") {
				control |= bit;
				payload.push(command);
			} else {
				if (sawMatch)
					throw new Error("Consecutive matches need a shared count byte");
				payload.push(command[0], command[1] - 2);
				sawMatch = true;
			}
			bit >>= 1;
		}
		bytes.push(control, ...payload);
	}
	return Buffer.from(bytes);
}

/** Builds a packed payload: the unpacked size in front of the stream. */
function packedPayload(
	content: Buffer,
	commands: readonly (number | readonly [number, number])[],
): Buffer {
	const stream = buildLin2Stream(commands);
	const prefix = Buffer.alloc(4);
	prefix.writeUInt32LE(content.length, 0);
	return Buffer.concat([prefix, stream]);
}

/** Builds a `LIN2` archive whose index precedes the payloads. */
function buildLin2(entries: readonly Entry[]): Buffer {
	const names = entries.map((entry) => maskName(entry.name));
	const records = names.map((name) => 2 + name.length + 10);
	const indexSize = records.reduce((total, size) => total + size, 0);
	const payloadBase = 8 + indexSize;
	const stored = entries.map((entry) => entry.stored ?? entry.content);
	const offsets: number[] = [];
	let running = payloadBase;
	for (const payload of stored) {
		offsets.push(running);
		running += payload.length;
	}

	const archive = Buffer.alloc(running);
	archive.write("LIN2", 0, "latin1");
	archive.writeInt32LE(entries.length, 4);
	let cursor = 8;
	for (const [id, name] of names.entries()) {
		archive.writeUInt16LE(name.length, cursor);
		name.copy(archive, cursor + 2);
		cursor += 2 + name.length;
		archive.writeUInt32LE(offsets[id] ?? 0, cursor);
		archive.writeUInt32LE(stored[id]?.length ?? 0, cursor + 4);
		archive.writeInt16LE(entries[id]?.type ?? 0, cursor + 8);
		cursor += 10;
	}
	let payloadOffset = payloadBase;
	for (const payload of stored) {
		payload.copy(archive, payloadOffset);
		payloadOffset += payload.length;
	}
	return archive;
}

describe("KaGuYa script engine resource archive", () => {
	it("lists stored, audio and packed entries and decodes the packed one", async () => {
		const raw = Buffer.from("stored payload");
		const audio = Buffer.from("audio payload");
		const packed = Buffer.from("packed payload");
		await expectArchive({
			format: kaguyaLin2Format,
			archive: buildLin2([
				{ name: "raw.bin", content: raw },
				{ name: "sound.ogg", content: audio, type: 2 },
				{
					name: "packed.bin",
					content: packed,
					stored: packedPayload(
						packed,
						[...packed].map((value) => value),
					),
					type: 1,
				},
			]),
			entries: [
				{ path: "raw.bin", size: raw.length, content: raw },
				{ path: "sound.ogg", size: audio.length, content: audio },
				{ path: "packed.bin", size: packed.length, content: packed },
			],
			metadata: { entryCount: 3 },
		});
	});

	it("marks audio entries in their metadata", async () => {
		const audio = Buffer.from("audio");
		const archive = await kaguyaLin2Format.open(
			new BufferByteSource(
				buildLin2([{ name: "sound.ogg", content: audio, type: 2 }]),
			),
			"sample.lin",
		);
		expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
		await archive.close();
	});

	it("copies matches with overlapping reads", async () => {
		// Two literals seed the ring, then one match copies four bytes from behind the write position.
		const content = Buffer.from("ABABAB");
		const commands: (number | readonly [number, number])[] = [
			0x41,
			0x42,
			[0xef, 4] as const,
		];
		await expectArchive({
			format: kaguyaLin2Format,
			archive: buildLin2([
				{
					name: "match.bin",
					content,
					stored: packedPayload(content, commands),
					type: 1,
				},
			]),
			entries: [{ path: "match.bin", size: content.length, content }],
		});
	});

	it("stops a name at its terminator inside the field", async () => {
		const content = Buffer.from("padded name payload");
		const archive = buildLin2([{ name: "name.bin\0xy", content }]);
		await expectArchive({
			format: kaguyaLin2Format,
			archive,
			entries: [{ path: "name.bin", size: content.length, content }],
		});
	});

	it("keeps backslashes verbatim", async () => {
		const content = Buffer.from("payload");
		// The reference is not hierarchical, so a backslash stays part of the name.
		await expectArchive({
			format: kaguyaLin2Format,
			archive: buildLin2([{ name: "dir\\file.bin", content }]),
			entries: [{ path: "dir\\file.bin", size: content.length, content }],
		});
	});

	it("rejects an empty name", async () => {
		const archive = buildLin2([{ name: "", content: Buffer.from("x") }]);
		expect(
			await kaguyaLin2Format.detect(
				new BufferByteSource(archive),
				"sample.lin",
			),
		).toBe(false);
	});

	it("rejects a foreign signature", async () => {
		const archive = buildLin2([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.write("LIN3", 0, "latin1");
		expect(
			await kaguyaLin2Format.detect(
				new BufferByteSource(archive),
				"sample.lin",
			),
		).toBe(false);
	});

	it("rejects an insane entry count", async () => {
		const archive = buildLin2([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.writeInt32LE(0x40000, 4);
		expect(
			await kaguyaLin2Format.detect(
				new BufferByteSource(archive),
				"sample.lin",
			),
		).toBe(false);
	});

	it("rejects a record that reaches past the archive", async () => {
		const archive = buildLin2([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.writeUInt16LE(0x400, 8);
		expect(
			await kaguyaLin2Format.detect(
				new BufferByteSource(archive),
				"sample.lin",
			),
		).toBe(false);
	});

	it("rejects a payload outside the archive", async () => {
		const archive = buildLin2([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.writeUInt32LE(0x1000, 8 + 2 + "a.bin".length);
		expect(
			await kaguyaLin2Format.detect(
				new BufferByteSource(archive),
				"sample.lin",
			),
		).toBe(false);
	});

	it("rejects a packed payload whose stream runs out", async () => {
		const content = Buffer.from("truncated");
		const payload = packedPayload(content, [0x41]);
		// Drop the last stream byte so a literal is missing.
		const archive = buildLin2([
			{
				name: "short.bin",
				content,
				stored: payload.subarray(0, payload.length - 1),
				type: 1,
			},
		]);
		const handle = await kaguyaLin2Format.open(
			new BufferByteSource(archive),
			"sample.lin",
		);
		// The opener decodes eagerly, so the truncation surfaces when the entry is opened.
		await expect(handle.openEntry(handle.entries[0]?.id ?? "")).rejects.toThrow(
			/Truncated/,
		);
		await handle.close();
	});
});
