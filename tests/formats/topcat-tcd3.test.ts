// The TopCat data archive (GARbro "ArcFormats/TopCat/ArcTCD3.cs", class TcdOpener), against archives built
// in the test: a table of sections at the head of the file, and within a section a table of the directories
// of the engine, a table of the names of the files of those directories, and a table of the places of the
// files themselves.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { topcatTcd3Format } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	oggCrc32,
	restoreTcdOggPages,
	unpackTcdScript,
} from "../../packages/formats/src/topcat/tcd3.js";

/** The cipher every table of names of the fixture stands of: the engine's own stands of the section's. */
const KEY = 0x5a;
/** The extensions of the five sections of the engine, of the number of the section. */
const EXTENSIONS = ["tct", "tsf", "spd", "ogg", "wav"] as const;

interface FileIn {
	name: string;
	data: Buffer;
}

interface SectionIn {
	number: number;
	dirs: { name: string; files: FileIn[] }[];
}

function le32(value: number): Buffer {
	const out = Buffer.alloc(4);
	out.writeUInt32LE(value >>> 0, 0);
	return out;
}

/** Every place of a table of names, of the cipher of its own section taken off it. */
function encipher(plain: Buffer): Buffer {
	const out = Buffer.from(plain);
	for (let at = 0; at < out.length; at += 1) {
		out[at] = ((out[at] ?? 0) - KEY) & 0xff;
	}
	return out;
}

/** A field of a name of the third shape: the places of the name, a place of no name, and filling. */
function field(name: string, length: number): Buffer {
	const out = Buffer.alloc(length, 0x00);
	Buffer.from(name, "latin1").copy(out, 0);
	return out;
}

/**
 * An archive of the second or the third shape, of the sections given. The tables of every section stand one
 * behind the other behind the head of the file, and the places of the files stand behind every table.
 */
function build(input: { version: 2 | 3; sections: SectionIn[] }): Buffer {
	const v2 = 2 === input.version;
	const sectionCount = v2 ? 4 : 5;
	const head = Buffer.alloc(8 + sectionCount * 0x20, 0x00);
	head.write(v2 ? "TCD2" : "TCD3", 0, "latin1");
	head.writeInt32LE(
		input.sections.reduce(
			(sum, section) =>
				sum + section.dirs.reduce((count, dir) => count + dir.files.length, 0),
			0,
		),
		4,
	);
	const names = (list: { name: string }[], length: number): Buffer =>
		v2
			? Buffer.concat(
					list.map((item) =>
						Buffer.concat([
							Buffer.from(item.name, "latin1"),
							Buffer.from([0x00]),
						]),
					),
				)
			: Buffer.concat(list.map((item) => field(item.name, length)));
	const plans = input.sections.map((section) => {
		const fileNames = section.dirs.flatMap((dir) => dir.files);
		const dirLength = v2
			? section.dirs.reduce((sum, dir) => sum + dir.name.length + 1, 0)
			: Math.max(1, ...section.dirs.map((dir) => dir.name.length + 1));
		const nameLength = v2
			? fileNames.reduce((sum, file) => sum + file.name.length + 1, 0)
			: Math.max(1, ...fileNames.map((file) => file.name.length + 1));
		const dirWords: Buffer[] = [];
		let namesOffset = 0;
		let firstIndex = 0;
		for (const dir of section.dirs) {
			dirWords.push(
				le32(dir.files.length),
				le32(namesOffset),
				le32(firstIndex),
				le32(0),
			);
			namesOffset += v2
				? dir.files.reduce((sum, file) => sum + file.name.length + 1, 0)
				: dir.files.length * nameLength;
			firstIndex += dir.files.length;
		}
		const dirBlock = names(section.dirs, dirLength);
		const fileBlock = names(fileNames, nameLength);
		return {
			number: section.number,
			dirLength,
			nameLength,
			fileNames,
			dirBlock,
			dirWords,
			fileBlock,
			size:
				dirBlock.length +
				dirWords.length * 4 +
				fileBlock.length +
				(fileNames.length + 1) * 4,
		};
	});
	let tableAt = head.length;
	let dataAt = head.length + plans.reduce((sum, plan) => sum + plan.size, 0);
	const tables: Buffer[] = [];
	for (const plan of plans) {
		const offsets: Buffer[] = [le32(dataAt)];
		for (const file of plan.fileNames) {
			dataAt += file.data.length;
			offsets.push(le32(dataAt));
		}
		const table = Buffer.concat([
			encipher(plan.dirBlock),
			...plan.dirWords,
			encipher(plan.fileBlock),
			...offsets,
		]);
		tables.push(table);
		const record = Buffer.alloc(0x20, 0x00);
		record.writeUInt32LE(
			plan.fileNames.reduce((sum, file) => sum + file.data.length, 0),
			0,
		);
		if (v2) {
			record.writeInt32LE(plan.fileNames.length, 4);
			record.writeInt32LE(plan.dirWords.length / 4, 8);
			record.writeUInt32LE(tableAt, 12);
			record.writeInt32LE(plan.dirLength, 16);
			record.writeInt32LE(plan.nameLength, 20);
		} else {
			record.writeUInt32LE(tableAt, 4);
			record.writeInt32LE(plan.dirWords.length / 4, 8);
			record.writeInt32LE(plan.dirLength, 12);
			record.writeInt32LE(plan.fileNames.length, 16);
			record.writeInt32LE(plan.nameLength, 20);
		}
		record.copy(head, 8 + plan.number * 0x20);
		tableAt += table.length;
	}
	const data = plans.flatMap((plan) => plan.fileNames.map((file) => file.data));
	return Buffer.concat([head, ...tables, ...data]);
}

/** The places of a script of the engine, as the walk of the engine stores them. */
function scriptStored(plain: string): Buffer {
	const turned = Buffer.from(plain, "latin1");
	for (let at = 0; at < turned.length; at += 1) {
		const byte = turned[at] ?? 0;
		turned[at] = ((byte << 1) | (byte >> 7)) & 0xff;
	}
	return Buffer.concat([le32(turned.length), Buffer.from([0xff]), turned]);
}

/** An archive of the third shape of one section of two directories: a script, and a sound. */
function tcd3Fixture(): Buffer {
	return build({
		version: 3,
		sections: [
			{
				number: 0,
				dirs: [
					{
						name: "story",
						files: [{ name: "two", data: scriptStored("script!!") }],
					},
				],
			},
			{
				number: 4,
				dirs: [
					{
						name: "point",
						files: [{ name: "one", data: Buffer.from([0x11, 0x22, 0x33]) }],
					},
				],
			},
		],
	});
}

describe("TopCat data archive", () => {
	it("reads the tables of the sections, of the directories and of the names", async () => {
		const data = tcd3Fixture();
		const source = new BufferByteSource(data);
		expect(await topcatTcd3Format.detect(source, "sample.tcd")).toBe(true);
		const archive = await topcatTcd3Format.open(source, "sample.tcd");
		try {
			expect(archive.entries.map((entry) => entry.path).sort()).toEqual([
				"point/one.wav",
				"story/two.tct",
			]);
			const script = archive.entries.find((entry) =>
				entry.path.endsWith(".tct"),
			);
			if (!script) throw new Error("no script");
			expect(await consumeBuffer(await archive.openEntry(script.id))).toEqual(
				Buffer.from("script!!", "latin1"),
			);
			const sound = archive.entries.find((entry) =>
				entry.path.endsWith(".wav"),
			);
			if (!sound) throw new Error("no sound");
			expect(await consumeBuffer(await archive.openEntry(sound.id))).toEqual(
				Buffer.from([0x11, 0x22, 0x33]),
			);
		} finally {
			await archive.close();
		}
	});

	it("lists the files of every section of the head, of the places of each section of its own", async () => {
		const data = build({
			version: 3,
			sections: [
				{
					number: 0,
					dirs: [
						{
							name: "story",
							files: [{ name: "two", data: Buffer.alloc(13, 0x00) }],
						},
					],
				},
				{
					number: 4,
					dirs: [
						{
							name: "point",
							files: [{ name: "one", data: Buffer.from([0x11, 0x22, 0x33]) }],
						},
					],
				},
			],
		});
		const source = new BufferByteSource(data);
		expect(await topcatTcd3Format.detect(source, "sample.tcd")).toBe(true);
		const archive = await topcatTcd3Format.open(source, "sample.tcd");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"story/two.tct",
				"point/one.wav",
			]);
			expect(archive.entries.map((entry) => Number(entry.size))).toEqual([
				13, 3,
			]);
		} finally {
			await archive.close();
		}
	});

	it("reads the tables of the second shape as well, whose names stand of each other", async () => {
		const data = build({
			version: 2,
			sections: [
				{
					number: 1,
					dirs: [
						{
							name: "voice",
							files: [
								{ name: "first", data: Buffer.from([0x01, 0x02]) },
								{ name: "second", data: Buffer.from([0x03]) },
							],
						},
					],
				},
			],
		});
		const source = new BufferByteSource(data);
		expect(await topcatTcd3Format.detect(source, "sample.tcd")).toBe(true);
		const archive = await topcatTcd3Format.open(source, "sample.tcd");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"voice/first.tsf",
				"voice/second.tsf",
			]);
			const first = archive.entries[0];
			if (!first) throw new Error("no entry");
			expect(Number(first.size)).toBe(2);
		} finally {
			await archive.close();
		}
	});

	it("stands of the walk of the places of a page of an Ogg stream", () => {
		// The check word of the walk of `Crc32Normal`, of the word of the run read from its high places
		// down and of no count of the places of the file behind it. The count below is the published count
		// of the places of the file of that polynomial with the word of the run at nought and no count of
		// the places of the file behind it, worked out of the count a published table names.
		expect(oggCrc32(Buffer.from("123456789", "latin1"))).toBe(0x89a1897f);
		expect(oggCrc32(Buffer.alloc(0))).toBe(0);
		// The walk leaves the last page of a stream alone, so a page stands of places behind it here.
		const page = Buffer.concat([Buffer.alloc(27, 0x00), Buffer.alloc(4, 0x00)]);
		page.write("OggS", 0, "latin1");
		expect(restoreTcdOggPages(page).readUInt32LE(0x16)).toBe(0x9ea1a511);
		// A page whose places stand of no word of the engine stands as it stands.
		const other = Buffer.concat([Buffer.alloc(31, 0x01)]);
		expect(restoreTcdOggPages(other)).toEqual(other);
	});

	it("reads the places of a script of the engine, of the walk of the engine and of its own turn", () => {
		const plain = Buffer.from("script!!", "latin1");
		expect(unpackTcdScript(scriptStored("script!!"))).toEqual(plain);
		// A walk that names no count of the places it stands of, and a walk that names more places than
		// this port reads at all, of which each stands of nothing.
		expect(unpackTcdScript(Buffer.alloc(4, 0x00))).toBeUndefined();
		expect(
			unpackTcdScript(Buffer.concat([le32(0x5000000), Buffer.alloc(8, 0xff)])),
		).toBeUndefined();
	});

	it("stands of no file of another word at its head or of a table standing short", async () => {
		const good = tcd3Fixture();
		const count = Buffer.from(good);
		count.writeInt32LE(0x7fffffff, 4);
		const other = Buffer.from(good);
		other.write("TCD1", 0, "latin1");
		for (const [what, data] of [
			["another word at the head", other],
			["a count of files beyond any archive", count],
			["a file standing short of its own head", good.subarray(0, 0x10)],
		] as [string, Buffer][]) {
			const source = new BufferByteSource(data);
			expect(await topcatTcd3Format.detect(source, "other.tcd"), what).toBe(
				false,
			);
		}
		expect(EXTENSIONS.length).toBe(5);
	});
});
