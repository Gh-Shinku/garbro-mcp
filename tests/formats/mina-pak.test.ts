import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	minaBmpPakFormat,
	minaScriptPakFormat,
	minaWavPakFormat,
} from "../../packages/formats/src/mina/pak.js";
import { expectArchive } from "../helpers/archive.js";

/** A byte rotate left inside the byte, the inverse of what the script reader applies. */
function rotateLeft4(value: number): number {
	return (((value << 4) | (value >>> 4)) & 0xff) >>> 0;
}

interface BmpFixtureEntry {
	name: string;
	data: Buffer;
	/** Bytes between the name and the size word. */
	header?: Buffer;
}

/**
 * Builds a Mina bitmap archive: every entry is a name, five header bytes, a size word and the payload.
 * The first name doubles as the archive header probe.
 */
function buildBmpPak(entries: BmpFixtureEntry[]): Buffer {
	const parts: Buffer[] = [];
	for (const entry of entries) {
		const size = Buffer.alloc(4);
		size.writeUInt32LE(entry.data.length, 0);
		parts.push(
			Buffer.from(`${entry.name}\0`, "latin1"),
			entry.header ?? Buffer.alloc(5),
			size,
			entry.data,
		);
	}
	return Buffer.concat(parts);
}

interface WavFixtureEntry {
	name: string;
	dataSize: number;
	format: Buffer;
	data: Buffer;
}

/** Builds a Mina audio archive: a size, a name, a format chunk and the audio payload. */
function buildWavPak(
	entries: WavFixtureEntry[],
	sizeOverride?: number,
): Buffer {
	const parts: Buffer[] = [];
	for (const [index, entry] of entries.entries()) {
		const size = Buffer.alloc(4);
		size.writeUInt32LE(
			sizeOverride !== undefined && index === 0 ? sizeOverride : entry.dataSize,
			0,
		);
		const fmt = Buffer.alloc(4);
		fmt.writeUInt32LE(entry.format.length, 0);
		parts.push(
			size,
			Buffer.from(`${entry.name}\0`, "latin1"),
			fmt,
			entry.format,
			entry.data,
		);
	}
	return Buffer.concat(parts);
}

/** Builds a script line record: a length, two ignored bytes and the rotated line. */
function scriptLine(text: string): Buffer {
	const body = Buffer.from(text, "latin1");
	const head = Buffer.alloc(3);
	head[0] = body.length - 1;
	const rotated = Buffer.alloc(body.length);
	for (let index = 0; index < body.length; index += 1)
		rotated[index] = rotateLeft4(body[index] ?? 0);
	return Buffer.concat([head, rotated]);
}

/** Builds a Mina script archive: a name, a size and the encoded payload for every unit. */
function buildScriptPak(entries: { name: string; data: Buffer }[]): Buffer {
	const parts: Buffer[] = [];
	for (const entry of entries) {
		const size = Buffer.alloc(4);
		size.writeUInt32LE(entry.data.length, 0);
		parts.push(Buffer.from(`${entry.name}\0`, "latin1"), size, entry.data);
	}
	return Buffer.concat(parts);
}

function sourceOf(archive: Buffer): BufferByteSource {
	return new BufferByteSource(archive);
}

describe("mina bitmap pak", () => {
	it("declines a file without the pak extension", async () => {
		const built = buildBmpPak([
			{ name: "IMG1.BMP", data: Buffer.from("body") },
		]);
		expect(await minaBmpPakFormat.detect(sourceOf(built), "game.bin")).toBe(
			false,
		);
	});

	it("declines a pak file whose header does not name a bitmap", async () => {
		const built = buildBmpPak([
			{ name: "IMG1.BIN", data: Buffer.from("body") },
		]);
		expect(await minaBmpPakFormat.detect(sourceOf(built), "game.pak")).toBe(
			false,
		);
	});

	it("lists and extracts bitmap entries", async () => {
		const first = Buffer.from("first bitmap");
		const second = Buffer.from("second");
		const built = buildBmpPak([
			{ name: "IMG1.BMP", data: first },
			{ name: "IMG2.BMP", data: second },
		]);
		await expectArchive({
			format: minaBmpPakFormat,
			archive: built,
			sourcePath: "GAME.PAK",
			entries: [
				{ path: "IMG1.BMP", size: first.length + 9 },
				{ path: "IMG2.BMP", size: second.length + 9 },
			],
		});
	});

	it("includes the nine byte header in the extracted entry", async () => {
		const data = Buffer.from("payload");
		const built = buildBmpPak([
			{ name: "IMG1.BMP", data, header: Buffer.from([1, 2, 3, 4, 5]) },
		]);
		const archive = await minaBmpPakFormat.open(sourceOf(built), "GAME.PAK");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const expected = Buffer.alloc(9 + data.length);
			Buffer.from([1, 2, 3, 4, 5]).copy(expected, 0);
			expected.writeUInt32LE(data.length, 5);
			data.copy(expected, 9);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				expected,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a bitmap entry whose name field is too long", async () => {
		const built = buildBmpPak([
			{ name: "A-VERY-LONG-NAME.BMP", data: Buffer.from("x") },
		]);
		expect(await minaBmpPakFormat.detect(sourceOf(built), "game.pak")).toBe(
			false,
		);
	});

	it("declines a bitmap entry that leaves the archive", async () => {
		const built = buildBmpPak([{ name: "IMG1.BMP", data: Buffer.from("x") }]);
		// Claim a payload far beyond the end of the file.
		built.writeUInt32LE(0x1000, 13);
		expect(await minaBmpPakFormat.detect(sourceOf(built), "game.pak")).toBe(
			false,
		);
	});
});

describe("mina audio pak", () => {
	it("declines a pak file whose header does not name audio", async () => {
		const built = buildWavPak([
			{
				name: "SND1.BIN",
				dataSize: 4,
				format: Buffer.alloc(0x10),
				data: Buffer.alloc(4),
			},
		]);
		expect(await minaWavPakFormat.detect(sourceOf(built), "game.pak")).toBe(
			false,
		);
	});

	it("declines a format chunk that is too small", async () => {
		const built = buildWavPak([
			{
				name: "SND1.WAV",
				dataSize: 4,
				format: Buffer.alloc(0x10),
				data: Buffer.alloc(4),
			},
		]);
		// Overwrite the format chunk size with an invalid value.
		const fmtOffset = 4 + "SND1.WAV".length + 1;
		built.writeUInt32LE(8, fmtOffset);
		expect(await minaWavPakFormat.detect(sourceOf(built), "game.pak")).toBe(
			false,
		);
	});

	it("wraps the format chunk and payload in a riff container", async () => {
		const format = Buffer.alloc(0x10);
		format.writeUInt16LE(1, 0);
		const data = Buffer.from([1, 2, 3, 4, 5, 6]);
		const built = buildWavPak([
			{ name: "SND1.WAV", dataSize: data.length, format, data },
		]);
		const archive = await minaWavPakFormat.open(sourceOf(built), "GAME.PAK");
		try {
			expect(archive.entries).toHaveLength(1);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			// The declared size covers the format chunk size word and the chunk and payload.
			expect(entry.size).toBe(BigInt(4 + format.length + data.length));
			expect(entry.sizeKnown).toBe(false);
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(12 + 8 + format.length + 8 + data.length);
			expect(output.toString("latin1", 0, 4)).toBe("RIFF");
			// The reference writes the entry size plus 0x10, which is the total minus the header.
			expect(output.readUInt32LE(4)).toBe(output.length - 8);
			expect(output.toString("latin1", 8, 12)).toBe("WAVE");
			expect(output.toString("latin1", 0x0c, 0x10)).toBe("fmt ");
			expect(output.readUInt32LE(0x10)).toBe(format.length);
			expect(output.subarray(0x14, 0x14 + format.length)).toEqual(format);
			expect(
				output.toString("latin1", 0x14 + format.length, 0x18 + format.length),
			).toBe("data");
			expect(output.readUInt32LE(0x18 + format.length)).toBe(data.length);
			expect(output.subarray(0x1c + format.length)).toEqual(data);
		} finally {
			await archive.close();
		}
	});

	it("walks several audio entries", async () => {
		const format = Buffer.alloc(0x10);
		const first = Buffer.from([9, 9, 9]);
		const second = Buffer.from([7, 7]);
		const built = buildWavPak([
			{ name: "SND1.WAV", dataSize: first.length, format, data: first },
			{ name: "SND2.WAV", dataSize: second.length, format, data: second },
		]);
		const archive = await minaWavPakFormat.open(sourceOf(built), "GAME.PAK");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"SND1.WAV",
				"SND2.WAV",
			]);
			const entry = archive.entries[1];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.subarray(output.length - second.length)).toEqual(second);
		} finally {
			await archive.close();
		}
	});
});

describe("mina script pak", () => {
	it("declines a pak file that is not named script.pak", async () => {
		const built = buildScriptPak([
			{ name: "MAIN.SCR", data: scriptLine("abc") },
		]);
		expect(await minaScriptPakFormat.detect(sourceOf(built), "OTHER.PAK")).toBe(
			false,
		);
	});

	it("rotates script lines back and inserts line breaks", async () => {
		const built = buildScriptPak([
			{
				name: "MAIN.SCR",
				data: Buffer.concat([scriptLine("hello"), scriptLine("world!")]),
			},
		]);
		const archive = await minaScriptPakFormat.open(
			sourceOf(built),
			"SCRIPT.PAK",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.path).toBe("MAIN.SCR");
			expect(entry.sizeKnown).toBe(false);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.from("hello\r\nworld!\r\n", "latin1"),
			);
		} finally {
			await archive.close();
		}
	});

	it("lists every script unit", async () => {
		const built = buildScriptPak([
			{ name: "MAIN.SCR", data: scriptLine("aaa") },
			{ name: "SUB.SCR", data: scriptLine("bb") },
		]);
		const archive = await minaScriptPakFormat.open(
			sourceOf(built),
			"SCRIPT.PAK",
		);
		try {
			expect(
				archive.entries.map((entry) => ({
					path: entry.path,
					size: entry.size,
				})),
			).toEqual([
				{ path: "MAIN.SCR", size: 6n },
				{ path: "SUB.SCR", size: 5n },
			]);
		} finally {
			await archive.close();
		}
	});

	it("declines a script entry that leaves the archive", async () => {
		const built = buildScriptPak([
			{ name: "MAIN.SCR", data: scriptLine("abc") },
		]);
		// Inflate the stored size beyond the end of the file.
		built.writeUInt32LE(0x1000, "MAIN.SCR".length + 1);
		expect(
			await minaScriptPakFormat.detect(sourceOf(built), "SCRIPT.PAK"),
		).toBe(false);
	});

	it("accepts a script archive through the archive helper", async () => {
		const built = buildScriptPak([
			{ name: "MAIN.SCR", data: scriptLine("xyz") },
		]);
		await expectArchive({
			format: minaScriptPakFormat,
			archive: built,
			sourcePath: "SCRIPT.PAK",
			entries: [
				{
					path: "MAIN.SCR",
					size: 6,
					content: Buffer.from("xyz\r\n", "latin1"),
				},
			],
		});
	});
});
