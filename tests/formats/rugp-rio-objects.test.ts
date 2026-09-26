// The object graph of the rUGP engine, against runs written in the test: the manifest of a game (the object
// the `.ici` file of an engine hands the archives of it), the blocks of the version of a project, and the
// refusals the reference itself stands of (the class list of an archive that does not stand encrypted, the
// message classes of a type, and the classes of the graph this project does not carry yet).
import { Buffer } from "node:buffer";
import { GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { RioStream } from "../../packages/formats/src/rugp/rio-core.js";
import {
	createRioObject,
	RioArchive,
	RioObjectArcMan,
	RioOceanNode,
	RioStdb,
	RioUnknown1,
} from "../../packages/formats/src/rugp/rio-objects.js";

/** A string of the engine: a length of one place and then the places of a cp932 run. */
function rioStr(text: string): Buffer {
	const body = Buffer.from(text, "latin1");
	return Buffer.concat([Buffer.from([body.length]), body]);
}

/** A count of sixteen places. */
function rioCount(count: number): Buffer {
	const out = Buffer.alloc(2, 0x00);
	out.writeUInt16LE(count, 0);
	return out;
}

/** A class of the stream itself: the tag, the schema and the name. */
function runtimeClass(name: string, schema = 0x10): Buffer {
	const body = Buffer.alloc(4 + name.length, 0x00);
	body.writeUInt16LE(schema, 0);
	body.writeUInt16LE(name.length, 2);
	body.write(name, 4, "latin1");
	const tag = Buffer.alloc(2, 0x00);
	tag.writeUInt16LE(0xffff, 0);
	return Buffer.concat([tag, body]);
}

/**
 * A manifest of the fifth version of the engine: the places of the least of the walks of `CObjectArcMan`, of
 * no archive behind it.
 */
function manifestBody(input?: { title?: string; archive?: boolean }): Buffer {
	const body: Buffer[] = [];
	const i32 = (value: number) => {
		const out = Buffer.alloc(4, 0x00);
		out.writeInt32LE(value, 0);
		return out;
	};
	body.push(i32(5)); // the version of the manifest
	body.push(i32(0x1873be26)); // the field the reference stands of
	body.push(Buffer.from([0, 0])); // two places of no meaning
	body.push(i32(0), i32(0), i32(0)); // three counts of no meaning
	body.push(rioStr(input?.title ?? "a game of the engine"));
	body.push(i32(0));
	body.push(rioStr(""));
	body.push(i32(0));
	body.push(rioStr(""), rioStr(""), rioStr(""));
	body.push(i32(0));
	body.push(rioStr(""));
	// The run of the strings of the manifest, which stands of a count of its own.
	body.push(rioCount(1), rioStr("first"));
	body.push(i32(0));
	// The field of the fifth version, and then the runs of the archives of the game.
	body.push(i32(0x30));
	body.push(rioCount(input?.archive === true ? 1 : 0));
	if (input?.archive === true) {
		// A run of one archive, of the place of nothing in front of it: the walk of the object behind that
		// place stands unported, and this one leaves it as it stands.
		body.push(Buffer.from([0]));
	}
	return Buffer.concat(body);
}

/** The head of a manifest of the engine, of the class of it and the list of the nodes behind it. */
function manifestHead(nodes: number): Buffer {
	return Buffer.concat([
		Buffer.from("cd326e59", "hex"),
		Buffer.from([0x10, 0x00]),
		runtimeClass("CObjectArcMan"),
		rioCount(nodes),
	]);
}

/** A manifest of a game of no node of its own. */
function manifestRun(input?: { title?: string; archive?: boolean }): Buffer {
	return Buffer.concat([manifestHead(0), manifestBody(input)]);
}

describe("rUGP object graph", () => {
	it("walks the manifest of a game", () => {
		const archive = new RioArchive(new RioStream(manifestRun()));
		const root = archive.deserializeRoot();
		expect(root).toBeInstanceOf(RioObjectArcMan);
		const manifest = root as RioObjectArcMan;
		// The mark of the archive of no cipher stands of the place of it of the graph, and the manifest
		// stands of the version and the strings of its own.
		expect(manifest.flags).toBe(0x80);
		expect(manifest.version).toBe(5);
		expect(manifest.title).toBe("a game of the engine");
		expect(manifest.field80.places).toEqual(["first"]);
		expect(manifest.field98).toBe(0x30);
		expect(manifest.arcList.places).toEqual([]);
		// The count of the places of the graph stands of the archive, of the class the stream carried itself
		// and of the root: a class of the stream takes a place of the count as well, which is the place a tag
		// of the graph names it of.
		expect(archive.loadCount).toBe(4);
	});

	it("holds a run of the archives of a game to the places of every one of them", () => {
		const archive = new RioArchive(
			new RioStream(manifestRun({ archive: true })),
		);
		const manifest = archive.deserializeRoot() as RioObjectArcMan;
		expect(manifest.arcList.places).toEqual([undefined]);
	});

	it("stands of the classes of the graph of the engine alone", () => {
		// The classes of the table of the engine stand of the works of their own, and every other class is
		// turned away rather than guessed at.
		expect(createRioObject("CStdb")).toBeInstanceOf(RioStdb);
		expect(createRioObject("CObjectOcean")).toBeDefined();
		expect(() => createRioObject("CNothing")).toThrow(GarbroError);
		expect(() => createRioObject("CNothing")).toThrow(/stands unported/);
	});

	it("walks a class list of an archive that stands unencrypted", () => {
		// The walk of such a list reads the name of every node of it, stands a node of that name and walks the
		// node: the branch of the reference that asks its own map for a node of the name (`FindObject`) stands
		// behind a walk that never hands back a node of nothing, so it is unreachable rather than unported.
		// The node of a graph: the flags of it, the count of the places of the class behind it, the class
		// itself, and then the places of the node — of the count of the places of a picture of a game.
		const node = Buffer.concat([
			Buffer.from([0x08, 0x00]),
			Buffer.from([0x00, 0x00]),
			runtimeClass("CS5i"),
			Buffer.from([0x00, 0x01, 0x00, 0x00]),
			Buffer.from([0x00, 0x02, 0x00, 0x00]),
			rioCount(0), // the class list of the node itself
		]);
		const run = Buffer.concat([
			manifestHead(1),
			rioStr("a picture of the game"),
			node,
			manifestBody(),
		]);
		const archive = new RioArchive(new RioStream(run));
		const manifest = archive.deserializeRoot() as RioObjectArcMan;
		expect(manifest.version).toBe(5);
		const nodes = archive.loadNodes();
		expect(nodes).toHaveLength(1);
		expect(nodes[0]?.name).toBe("a picture of the game");
		expect(nodes[0]?.className).toBe("CS5i");
		expect(nodes[0]?.offset).toBe(0x100);
		expect(nodes[0]?.size).toBe(0x200);
		expect(nodes[0]?.getPathName()).toBe("a picture of the game");
	});

	it("holds the walk of the graph to the places of the stream", () => {
		// A stream that ends within the places of the head of the graph, and a class the walk of the graph
		// does not carry.
		expect(() =>
			new RioArchive(new RioStream(Buffer.alloc(6, 0x00))).deserializeRoot(),
		).toThrow(GarbroError);
		const other = Buffer.concat([
			Buffer.from("cd326e59", "hex"),
			Buffer.from([0x10, 0x00]),
			runtimeClass("CNothing"),
			rioCount(0),
		]);
		expect(() =>
			new RioArchive(new RioStream(other)).deserializeRoot(),
		).toThrow(/stands unported/);
	});

	it("walks the blocks of the version of a project", () => {
		// The block stands of the version of its own: the least of them reads four strings and a count.
		const run = Buffer.concat([
			Buffer.alloc(4, 0x00),
			rioStr("one"),
			rioStr("two"),
			rioStr("three"),
			rioStr("four"),
			Buffer.from([0xe8, 0x03, 0x00, 0x00]),
		]);
		const archive = new RioArchive(new RioStream(run));
		const block = new RioUnknown1();
		block.deserialize(archive);
		expect(block.version).toBe(0);
		expect(block.field08).toBe("one");
		expect(block.field0C).toBe("two");
		expect(block.field14).toBe("three");
		expect(block.field1C).toBe("four");
		expect(block.field18).toBe(1000);
		// The version of the walk stands of every place behind it where it names one.
		const second = Buffer.concat([
			Buffer.from([0x06, 0x00, 0x00, 0x00]),
			rioStr("branch"),
			rioStr("version"),
			rioStr("name"),
			rioStr("title"),
			rioStr("copyright"),
			Buffer.from([0x64, 0x00, 0x00, 0x00]),
			Buffer.alloc(16, 0x11),
			Buffer.from([0x00, 0x00, 0x00, 0x00]),
			rioStr("a"),
			rioStr("b"),
			rioStr("c"),
			rioStr("d"),
			Buffer.from([0x02, 0x00, 0x00, 0x00]),
			Buffer.from([0x01, 0x00, 0x00, 0x00]),
			rioStr("e"),
			rioStr("f"),
			rioStr("g"),
		]);
		const walked = new RioUnknown1();
		walked.deserialize(new RioArchive(new RioStream(second)));
		expect(walked.version).toBe(6);
		expect(walked.field04).toBe("branch");
		expect(walked.field48).toBe("e");
		expect(walked.field4C).toBe("f");
		expect(walked.field50).toBe("g");
	});

	it("walks a name of the engine, and the places of a node of the graph", () => {
		const run = rioStr("a name");
		const stdb = new RioStdb();
		stdb.deserialize(new RioArchive(new RioStream(run)));
		expect(stdb.field0C).toBe("a name");
		// The name of a node of the graph is the names of the nodes of it to the root, of the separator of the
		// engine, and a node of no name stands of the places of nothing.
		const root = new RioOceanNode("root");
		const middle = new RioOceanNode("middle");
		const leaf = new RioOceanNode("leaf");
		middle.parent = root;
		leaf.parent = middle;
		leaf.className = "CS5i";
		expect(leaf.getPathName()).toBe("root/middle/leaf");
		expect(new RioOceanNode("").getPathName()).toBe("");
	});
});
