import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { willArcFormat } from "../../packages/formats/src/will/arc.js";
import { expectArchive } from "../helpers/archive.js";

interface FixtureFile {
	name: string;
	data: Buffer;
	/** Overrides the stored size word. */
	storedSize?: number;
	/** Overrides the stored offset word. */
	storedOffset?: number;
	/** Writes a name field of NUL bytes instead of the name. */
	blankName?: boolean;
}

interface FixtureGroup {
	/** Extension field, up to four characters. */
	extension?: string;
	files: FixtureFile[];
	dirOffsetOverride?: number;
}

/** A byte rotate left inside the byte, the inverse of what the reader applies to scripts. */
function rotateLeft2(value: number): number {
	return (((value << 2) | (value >>> 6)) & 0xff) >>> 0;
}

function rotateLeft2Buffer(data: Buffer): Buffer {
	const output = Buffer.alloc(data.length);
	for (let index = 0; index < data.length; index += 1)
		output[index] = rotateLeft2(data[index] ?? 0);
	return output;
}

/**
 * Builds a Will ARC: an extension table, then one file list per extension, then the payloads. Name
 * fields are nine or thirteen bytes wide and the payload offsets are absolute.
 */
function buildWillArc(
	groups: FixtureGroup[],
	options: { nameSize?: number; countDelta?: number } = {},
): Buffer {
	const nameSize = options.nameSize ?? 9;
	const tableSize = 4 + groups.length * 0x0c;
	let cursor = tableSize;
	const table = Buffer.alloc(tableSize);
	table.writeInt32LE(groups.length + (options.countDelta ?? 0), 0);
	const listParts: Buffer[] = [];
	const listOffsets: number[] = [];
	for (const [index, group] of groups.entries()) {
		const listSize = group.files.length * (nameSize + 8);
		const dirOffset = group.dirOffsetOverride ?? cursor;
		listOffsets.push(dirOffset);
		table.write(group.extension ?? "", 4 + index * 0x0c, 4, "latin1");
		table.writeInt32LE(group.files.length, 4 + index * 0x0c + 4);
		table.writeUInt32LE(dirOffset, 4 + index * 0x0c + 8);
		const list = Buffer.alloc(listSize);
		for (const [entry, file] of group.files.entries()) {
			const base = entry * (nameSize + 8);
			if (!file.blankName) list.write(file.name, base, nameSize, "latin1");
			list.writeUInt32LE(file.storedSize ?? file.data.length, base + nameSize);
			list.writeUInt32LE(file.storedOffset ?? 0, base + nameSize + 4);
		}
		listParts.push(list);
		if (group.dirOffsetOverride === undefined) cursor += listSize;
	}
	const payloadStart = cursor;
	const payloads: Buffer[] = [];
	let payloadOffset = payloadStart;
	const offsets: number[] = [];
	for (const group of groups) {
		for (const file of group.files) {
			offsets.push(payloadOffset);
			payloads.push(file.data);
			payloadOffset += file.data.length;
		}
	}
	// Fill in the real payload offsets now that the payload block is laid out.
	let number = 0;
	for (const [index, group] of groups.entries()) {
		const list = listParts[index];
		if (!list) continue;
		for (const [entry, file] of group.files.entries()) {
			if (file.storedOffset === undefined) {
				const base = entry * (nameSize + 8);
				list.writeUInt32LE(offsets[number] ?? 0, base + nameSize + 4);
			}
			number += 1;
		}
	}
	return Buffer.concat([
		table,
		...listParts,
		Buffer.alloc(
			Math.max(
				payloadStart -
					(tableSize +
						listParts.reduce((total, part) => total + part.length, 0)),
				0,
			),
		),
		...payloads,
	]);
}

function sourceOf(archive: Buffer): BufferByteSource {
	return new BufferByteSource(archive);
}

describe("will ARC", () => {
	it("declines an archive without extension records", async () => {
		const built = buildWillArc([]);
		expect(await willArcFormat.detect(sourceOf(built), "sample.arc")).toBe(
			false,
		);
	});

	it("declines an extension record with a zero file count", async () => {
		const built = buildWillArc([{ extension: "WIP", files: [] }]);
		expect(await willArcFormat.detect(sourceOf(built), "sample.arc")).toBe(
			false,
		);
	});

	it("declines an extension record whose directory is inside the table", async () => {
		const built = buildWillArc(
			[{ extension: "WIP", files: [{ name: "a", data: Buffer.from("x") }] }],
			{ nameSize: 9 },
		);
		// Point the record at its own header offset inside the table.
		built.writeUInt32LE(4, 12);
		expect(await willArcFormat.detect(sourceOf(built), "sample.arc")).toBe(
			false,
		);
	});

	it("lists and extracts entries with nine byte name fields", async () => {
		const built = buildWillArc([
			{
				extension: "WIP",
				files: [
					{ name: "data", data: Buffer.from("first payload") },
					{ name: "other", data: Buffer.from("second") },
				],
			},
		]);
		await expectArchive({
			format: willArcFormat,
			archive: built,
			entries: [
				{
					path: "data.wip",
					size: 13,
					content: Buffer.from("first payload"),
				},
				{ path: "other.wip", size: 6, content: Buffer.from("second") },
			],
		});
		const archive = await willArcFormat.open(sourceOf(built), "sample.arc");
		try {
			expect(archive.metadata).toMatchObject({ nameSize: 9 });
		} finally {
			await archive.close();
		}
	});

	it("falls back to thirteen byte name fields", async () => {
		const built = buildWillArc(
			[
				{
					extension: "WIP",
					// A twelve character name makes the nine byte attempt read a bogus size word out
					// of the name padding, so only the thirteen byte layout can be parsed.
					files: [{ name: "longerscript", data: Buffer.from("thirteen") }],
				},
			],
			{ nameSize: 13 },
		);
		const archive = await willArcFormat.open(sourceOf(built), "sample.arc");
		try {
			expect(archive.metadata).toMatchObject({ nameSize: 13 });
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"longerscript.wip",
			]);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.from("thirteen"),
			);
		} finally {
			await archive.close();
		}
	});

	it("keeps the stored name when the extension field is empty", async () => {
		const built = buildWillArc([
			{ files: [{ name: "raw.bin", data: Buffer.from("raw") }] },
		]);
		await expectArchive({
			format: willArcFormat,
			archive: built,
			entries: [{ path: "raw.bin", size: 3, content: Buffer.from("raw") }],
		});
	});

	it("lowercases names and extensions", async () => {
		const built = buildWillArc([
			{
				extension: "PNA",
				files: [{ name: "IMAGE", data: Buffer.from("png") }],
			},
		]);
		await expectArchive({
			format: willArcFormat,
			archive: built,
			entries: [{ path: "image.pna", size: 3, content: Buffer.from("png") }],
		});
	});

	it("rotates scr payloads back into place", async () => {
		const plain = Buffer.from("script body");
		const built = buildWillArc([
			{
				extension: "SCR",
				files: [{ name: "main", data: rotateLeft2Buffer(plain) }],
			},
		]);
		await expectArchive({
			format: willArcFormat,
			archive: built,
			entries: [{ path: "main.scr", size: 11, content: plain }],
		});
	});

	it("rotates wsc payloads back into place", async () => {
		const plain = Buffer.from([0x00, 0x01, 0xfe, 0xff, 0x80]);
		const built = buildWillArc([
			{
				extension: "WSC",
				files: [{ name: "sub", data: rotateLeft2Buffer(plain) }],
			},
		]);
		await expectArchive({
			format: willArcFormat,
			archive: built,
			entries: [{ path: "sub.wsc", size: 5, content: plain }],
		});
	});

	it("leaves other extensions unrotated", async () => {
		const data = Buffer.from("not rotated");
		const built = buildWillArc([
			{ extension: "TXT", files: [{ name: "note", data }] },
		]);
		await expectArchive({
			format: willArcFormat,
			archive: built,
			entries: [{ path: "note.txt", size: 11, content: data }],
		});
	});

	it("declines an entry with a blank name field", async () => {
		const built = buildWillArc([
			{
				extension: "WIP",
				files: [{ name: "gone", data: Buffer.from("x"), blankName: true }],
			},
		]);
		expect(await willArcFormat.detect(sourceOf(built), "sample.arc")).toBe(
			false,
		);
	});

	it("declines an entry that is not placed inside the archive", async () => {
		const built = buildWillArc([
			{
				extension: "WIP",
				files: [
					{
						name: "huge",
						data: Buffer.from("x"),
						storedSize: 0x10000,
					},
				],
			},
		]);
		expect(await willArcFormat.detect(sourceOf(built), "sample.arc")).toBe(
			false,
		);
	});

	it("walks several extension groups", async () => {
		const built = buildWillArc([
			{ extension: "WIP", files: [{ name: "img", data: Buffer.from("one") }] },
			{ extension: "PNA", files: [{ name: "pic", data: Buffer.from("two") }] },
			{
				extension: "OGG",
				files: [{ name: "bgm", data: Buffer.from("three") }],
			},
		]);
		await expectArchive({
			format: willArcFormat,
			archive: built,
			entries: [
				{ path: "img.wip", size: 3, content: Buffer.from("one") },
				{ path: "pic.pna", size: 3, content: Buffer.from("two") },
				{ path: "bgm.ogg", size: 5, content: Buffer.from("three") },
			],
		});
	});

	it("declines an extension count above the limit", async () => {
		const built = buildWillArc([
			{ extension: "WIP", files: [{ name: "a", data: Buffer.from("x") }] },
		]);
		built.writeInt32LE(0x100, 0);
		expect(await willArcFormat.detect(sourceOf(built), "sample.arc")).toBe(
			false,
		);
	});
});
