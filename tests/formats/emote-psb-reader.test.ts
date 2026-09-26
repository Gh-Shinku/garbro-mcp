// The first stage of the PSB container of the Emote engine (GARbro "ArcFormats/Emote/ArcPSB.cs", classes
// `PsbOpener` and `PsbReader`), against an archive built in the test. The engine stands of a head that names
// six tables, of two tables of names (the walk of a name stands of a table whose every place names the place
// of the walk behind it, and of a table that names the place behind every place of the first) and of a table
// of the objects of the file.
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
	PsbReader,
	readPsbHeader,
} from "../../packages/formats/src/emote/psb-reader.js";

/** The places of the file of the tables of the fixture. */
const NAMES = 0x28;
const ENTRIES = 0x400;
const PARENTS = NAMES + 6 + ENTRIES * 4;
const OBJECT = PARENTS + 6 + ENTRIES * 4 + 0x10;
const ROOT = OBJECT + 0x20;
const CHUNK_DATA = ROOT + 0x40;

/** A table of the objects of the file, of the count of the places of the count of its objects. */
function table(values: number[]): Buffer {
	const out = Buffer.alloc(6 + values.length * 4, 0x00);
	out[0] = 0x10; // the kind of the count of the places of the objects of the table
	out.writeUInt32LE(values.length, 1);
	out[5] = 0x10; // the kind of one object of the table: a count of four places of the file
	for (const [index, value] of values.entries())
		out.writeInt32LE(value, 6 + index * 4);
	return out;
}

/**
 * An archive of the engine, of the one name `x` and of one count of the file it stands of. The tables of the
 * names stand of a place for the root of the walk (nought), of a place for the one place behind it that the
 * name `x` stands of, and of a place for the place the walk of the name ends at.
 */
function psbFile(input: {
	name: string;
	value: number;
	broken?: "table" | "root" | "cipher";
}): Buffer {
	const file = Buffer.alloc(CHUNK_DATA, 0x00);
	file.write("PSB\0", 0, "latin1");
	file.writeUInt16LE(3, 4);
	file.writeUInt16LE("cipher" === input.broken ? 1 : 0, 6);
	const head = Buffer.alloc(0x20, 0x00);
	const place = (at: number, value: number): void => {
		head.writeInt32LE(value, at);
	};
	place(0x04, NAMES);
	place(0x08, NAMES); // the strings of the file stand of no use in this stage
	place(0x0c, NAMES);
	place(0x10, NAMES);
	place(0x14, NAMES);
	place(0x18, "table" === input.broken ? 0x10 : CHUNK_DATA);
	place(0x1c, ROOT);
	head.copy(file, 8);

	// The two tables of the names: the first names the place of the walk of a name behind every place, the
	// second names the place of the file a place of the walk stood at.
	const names = Array.from<number>({ length: ENTRIES }).fill(0);
	const parents = Array.from<number>({ length: ENTRIES }).fill(0x7fffffff);
	const child = 1 + input.name.charCodeAt(0);
	const terminal = 0x200;
	names[0] = 1; // the places of the walk behind the root of the names
	names[child] = terminal; // the place the name stands of
	parents[child] = 0;
	names[terminal] = OBJECT; // the place of the file of the object the name stands of
	parents[terminal] = child;
	const namesTable = table(names);
	const parentsTable = table(parents);
	namesTable.copy(file, NAMES);
	parentsTable.copy(file, PARENTS);

	// The object the name stands of, and the root of the file, which is a dictionary of one name.
	file[OBJECT] = 0x08; // a count of four places of the file
	file.writeInt32LE(input.value, OBJECT + 1);
	const keys = table([OBJECT]);
	file["root" === input.broken ? ROOT + 1 : ROOT] = 0x21;
	file[ROOT] = "root" === input.broken ? 0x20 : 0x21;
	keys.copy(file, ROOT + 1);
	const values = table([0]);
	const valuePlace = ROOT + 1 + keys.length + values.length;
	values.copy(file, ROOT + 1 + keys.length);
	// The object of the dictionary stands where the table of its places names it.
	if (valuePlace + 5 <= file.length) {
		file[valuePlace] = 0x08;
		file.writeInt32LE(input.value, valuePlace + 1);
	}
	return file;
}

describe("Emote PSB container, the first stage", () => {
	it("reads the head of the archive and the places of its tables", () => {
		const data = psbFile({ name: "x", value: 0x0040abcd });
		const header = readPsbHeader(data, false);
		expect(header).toMatchObject({
			version: 3,
			flags: 0,
			names: NAMES,
			chunkData: CHUNK_DATA,
			root: ROOT,
		});
		expect(header?.extraOffsets).toBeUndefined();
		// A head whose table stands before the least place of a table of the engine stands refused.
		expect(
			readPsbHeader(psbFile({ name: "x", value: 1, broken: "table" }), false),
		).toBeUndefined();
		// A head of the cipher of the engine stands in the stage behind this one.
		expect(
			readPsbHeader(psbFile({ name: "x", value: 1, broken: "cipher" }), false),
		).toBeUndefined();
	});

	it("reads a name of the file out of the two tables of the names", () => {
		const data = psbFile({ name: "x", value: 0x0040abcd });
		const reader = PsbReader.parse(data);
		if (!reader) throw new Error("no reader");
		expect(reader.offsetOf("x")).toBe(OBJECT);
		expect(reader.offsetOf("y")).toBeUndefined();
		expect(reader.offsetOf("")).toBeUndefined();
		expect([...reader.nameMap()]).toEqual([[OBJECT, "x"]]);
	});

	it("reads an object of the file out of a dictionary of the file", () => {
		const data = psbFile({ name: "x", value: 0x0040abcd });
		const reader = PsbReader.parse(data);
		if (!reader) throw new Error("no reader");
		const at = reader.key("x", ROOT);
		expect(at).toBeTypeOf("number");
		if (undefined === at) throw new Error("no place");
		expect(reader.scalar(at)).toBe(0x0040abcd);
		expect(reader.key("y", ROOT)).toBeUndefined();
		// The object the name stands of stands of the table of the names as well.
		expect(reader.scalar(OBJECT)).toBe(0x0040abcd);
	});

	it("stands of no file of another object at the root of the file or of no head at all", () => {
		const broken = psbFile({ name: "x", value: 1, broken: "root" });
		expect(PsbReader.parse(broken)).toBeUndefined();
		expect(PsbReader.parse(Buffer.alloc(0x10, 0x00))).toBeUndefined();
	});
});
