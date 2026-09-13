import { BufferByteSource } from "@garbro-mcp/core";
import { wagFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_OFFSET = 0x4a;
const IMGD_FILLER = 6;
const SECTION_PADDING = 2;

/** `Binary.RotByteR (value, 4)`, applied to every index byte. */
function rotateByte(value: number): number {
	return ((value >> 4) | (value << 4)) & 0xff;
}

function encrypt(bytes: Buffer): Buffer {
	const output = Buffer.from(bytes);
	for (let index = 0; index < output.length; index += 1)
		output[index] = rotateByte(output[index] ?? 0);
	return output;
}

function readName(name: string): Buffer {
	return Buffer.from(name, "latin1");
}

/** An `FNNE` section: a length that counts its own two byte trailer, then the name. */
function fnne(name: string): Buffer {
	const field = readName(name);
	const section = Buffer.alloc(8 + 2 + field.length + SECTION_PADDING);
	section.write("FNNE", 0, "latin1");
	section.writeInt32LE(field.length + 2, 4);
	field.copy(section, 8 + 2);
	return section;
}

/**
 * An `IMGD` section. The reference reports an entry as `size + 0x10` bytes long while its own walk steps
 * `size + 0x0A` bytes, so the section carries six filler bytes before its two byte trailer.
 */
function imgd(payload: Buffer): { section: Buffer; content: Buffer } {
	const section = Buffer.alloc(
		8 + payload.length + IMGD_FILLER + SECTION_PADDING,
	);
	section.write("IMGD", 0, "latin1");
	section.writeUInt32LE(payload.length, 4);
	payload.copy(section, 8);
	return { section, content: section.subarray(0, payload.length + 0x10) };
}

/** A section the reader has no handling for; it is skipped by its own size. */
function unknownSection(marker: string, size: number): Buffer {
	const section = Buffer.alloc(8 + size + SECTION_PADDING);
	section.write(marker, 0, "latin1");
	section.writeUInt32LE(size, 4);
	return section;
}

function record(sections: readonly Buffer[]): Buffer {
	const header = Buffer.alloc(4 + 4 + 2);
	header.write("DATA", 0, "latin1");
	header.writeInt32LE(sections.length, 4);
	return Buffer.concat([header, ...sections]);
}

/** Lays out a header, an offsets table and the records, encrypting everything behind the header. */
function buildWag(records: readonly (Buffer | null)[]): Buffer {
	const table = Buffer.alloc(records.length * 4);
	const bodies: Buffer[] = [];
	let cursor = INDEX_OFFSET + table.length;
	for (const [index, body] of records.entries()) {
		if (!body) continue;
		table.writeUInt32LE(cursor, index * 4);
		bodies.push(body);
		cursor += body.length;
	}
	const header = Buffer.alloc(INDEX_OFFSET);
	header.write("IAF_", 0, "latin1");
	header.writeUInt16LE(1, 4);
	header.writeInt32LE(records.length, 6);
	return Buffer.concat([header, encrypt(Buffer.concat([table, ...bodies]))]);
}

async function expectDeclined(file: Buffer): Promise<void> {
	expect(await wagFormat.detect(new BufferByteSource(file), "sample.wag")).toBe(
		false,
	);
}

describe("Hexenhaus WAG resource archive", () => {
	it("lists entries with their rotated payloads", async () => {
		const first = imgd(Buffer.from("first payload!"));
		const second = imgd(Buffer.from("second payload"));
		await expectArchive({
			format: wagFormat,
			sourcePath: "sample.wag",
			archive: buildWag([
				record([fnne("first.png"), first.section]),
				record([fnne("second.png"), second.section]),
			]),
			entries: [
				{
					path: "first.png",
					size: first.content.length,
					content: first.content,
				},
				{
					path: "second.png",
					size: second.content.length,
					content: second.content,
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("skips a record that does not start with DATA", async () => {
		const entry = imgd(Buffer.from("payload"));
		await expectArchive({
			format: wagFormat,
			sourcePath: "sample.wag",
			archive: buildWag([
				record([fnne("kept.dat"), entry.section]),
				Buffer.from("XXXXnothing here", "latin1"),
			]),
			entries: [
				{
					path: "kept.dat",
					size: entry.content.length,
					content: entry.content,
				},
			],
		});
	});

	it("skips a record without a payload section", async () => {
		const entry = imgd(Buffer.from("payload"));
		await expectArchive({
			format: wagFormat,
			sourcePath: "sample.wag",
			archive: buildWag([
				record([fnne("nameless.dat")]),
				record([fnne("kept.dat"), entry.section]),
			]),
			entries: [
				{
					path: "kept.dat",
					size: entry.content.length,
					content: entry.content,
				},
			],
		});
	});

	it("skips a record without a name", async () => {
		const entry = imgd(Buffer.from("payload"));
		await expectArchive({
			format: wagFormat,
			sourcePath: "sample.wag",
			archive: buildWag([
				record([entry.section]),
				record([fnne("kept.dat"), entry.section]),
			]),
			entries: [
				{
					path: "kept.dat",
					size: entry.content.length,
					content: entry.content,
				},
			],
		});
	});

	it("walks past an unknown section", async () => {
		const entry = imgd(Buffer.from("payload"));
		await expectArchive({
			format: wagFormat,
			sourcePath: "sample.wag",
			archive: buildWag([
				record([
					unknownSection("MOZA", 8),
					fnne("kept.dat"),
					unknownSection("ZZZZ", 5),
					entry.section,
				]),
			]),
			entries: [
				{
					path: "kept.dat",
					size: entry.content.length,
					content: entry.content,
				},
			],
		});
	});

	it("reads a name that does not fit into a small buffer", async () => {
		const name = `${"nested/".repeat(40)}long.png`;
		const entry = imgd(Buffer.from("payload"));
		await expectArchive({
			format: wagFormat,
			sourcePath: "sample.wag",
			archive: buildWag([record([fnne(name), entry.section])]),
			entries: [
				{
					path: name,
					size: entry.content.length,
					content: entry.content,
				},
			],
		});
	});

	it("rejects an archive without a usable count", async () => {
		const entry = imgd(Buffer.from("payload"));
		const file = buildWag([record([fnne("kept.dat"), entry.section])]);
		file.writeInt32LE(0, 6);
		await expectDeclined(file);
	});

	it("rejects a foreign signature", async () => {
		const entry = imgd(Buffer.from("payload"));
		const file = buildWag([record([fnne("kept.dat"), entry.section])]);
		file.write("ZZZZ", 0, "latin1");
		await expectDeclined(file);
	});

	it("rejects an archive whose records all fail", async () => {
		await expectDeclined(
			buildWag([record([fnne("only.dat")]), Buffer.from("XXXX", "latin1")]),
		);
	});
});
