import { amusePacFormat, softpalPacFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const RECORD_TAIL = 8;
const PREFIX_SIZE = 16;
const OBFUSCATION_XOR = 0xf7d5859d;

/** Mirrors the reference's payload transform so fixtures can predict the extracted bytes. */
function transform(data: Buffer): Buffer {
	const output = Buffer.from(data);
	const words = Math.trunc((output.length - PREFIX_SIZE) / 4);
	for (let index = 0; index < words; index += 1) {
		const position = PREFIX_SIZE + index * 4;
		const word = output.readUInt32LE(position);
		const low = word & 0xff;
		const shift = (4 + index) & 7;
		const rotated = ((low << shift) | (low >>> (8 - shift))) & 0xff;
		output.writeUInt32LE(
			(((word & 0xffffff00) | rotated) ^ OBFUSCATION_XOR) >>> 0,
			position,
		);
	}
	return output;
}

interface Entry {
	name: string;
	content: Buffer;
}

interface Layout {
	count: number;
	indexOffset: number;
	nameLength: number;
	signature?: Buffer;
	countOffset?: number;
}

/**
 * Builds an archive: a header, the index at its fixed offset with names, sizes and offsets, then payloads.
 * The first record's offset word doubles as the alignment check the readers rely on.
 */
function buildPac(entries: readonly Entry[], layout: Layout): Buffer {
	const stride = layout.nameLength + RECORD_TAIL;
	const dataOffset = layout.indexOffset + stride * entries.length;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	layout.signature?.copy(archive, 0);
	archive.writeInt32LE(entries.length, layout.countOffset ?? 0);
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = layout.indexOffset + id * stride;
		Buffer.from(entry.name, "latin1").copy(archive, record);
		archive.writeUInt32LE(entry.content.length, record + layout.nameLength);
		archive.writeUInt32LE(position, record + layout.nameLength + 4);
		entry.content.copy(archive, position);
		position += entry.content.length;
	}
	return archive;
}

describe("Softpal and Amuse PAC archives", () => {
	it("reads a Softpal archive with the wide name field", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: softpalPacFormat,
			archive: buildPac(
				[
					{ name: "one.dat", content: first },
					{ name: "two.dat", content: second },
				],
				{ count: 0, indexOffset: 0x3fe, nameLength: 0x20 },
			),
			sourcePath: "sample.pac",
			entries: [
				{ path: "one.dat", size: first.length, content: first },
				{ path: "two.dat", size: second.length, content: second },
			],
		});
	});

	it("reads a Softpal archive with the narrow name field", async () => {
		const content = Buffer.from("narrow body");
		await expectArchive({
			format: softpalPacFormat,
			archive: buildPac([{ name: "one.dat", content }], {
				count: 0,
				indexOffset: 0x3fe,
				nameLength: 0x10,
			}),
			sourcePath: "sample.pac",
			entries: [{ path: "one.dat", size: content.length, content }],
		});
	});

	it("transforms a marked payload behind its sixteen-byte prefix", async () => {
		const prefix = Buffer.alloc(PREFIX_SIZE, 0x11);
		const body = Buffer.from("transformed tail body!!");
		const stored = Buffer.concat([prefix, body]);
		stored[0] = 0x24;
		// The first sixteen bytes pass through untouched, so the expectation only differs behind them.
		const expected = Buffer.concat([
			Buffer.from(stored.subarray(0, PREFIX_SIZE)),
			transform(stored).subarray(PREFIX_SIZE),
		]);
		await expectArchive({
			format: softpalPacFormat,
			archive: buildPac([{ name: "one.dat", content: stored }], {
				count: 0,
				indexOffset: 0x3fe,
				nameLength: 0x20,
			}),
			sourcePath: "sample.pac",
			entries: [{ path: "one.dat", size: stored.length, content: expected }],
		});
	});

	it("reads an Amuse archive through its signature", async () => {
		const content = Buffer.from("amuse body");
		await expectArchive({
			format: amusePacFormat,
			archive: buildPac([{ name: "one.dat", content }], {
				count: 0,
				indexOffset: 0x804,
				nameLength: 0x20,
				signature: Buffer.from("PAC ", "latin1"),
				countOffset: 8,
			}),
			sourcePath: "sample.pac",
			entries: [{ path: "one.dat", size: content.length, content }],
		});
	});

	it("rejects an Amuse archive whose index is misaligned", async () => {
		const content = Buffer.from("amuse body");
		const archive = buildPac([{ name: "one.dat", content }], {
			count: 0,
			indexOffset: 0x804,
			nameLength: 0x20,
			signature: Buffer.from("PAC ", "latin1"),
			countOffset: 8,
		});
		archive.writeUInt32LE(0, 0x804 + 0x20 + 4);
		await expectArchive({
			format: amusePacFormat,
			archive,
			sourcePath: "sample.pac",
			detected: false,
			entries: [],
		});
	});

	it("requires the pac extension for the Softpal variant", async () => {
		const content = Buffer.from("body");
		await expectArchive({
			format: softpalPacFormat,
			archive: buildPac([{ name: "one.dat", content }], {
				count: 0,
				indexOffset: 0x3fe,
				nameLength: 0x20,
			}),
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});
});
