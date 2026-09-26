// The archive of the rUGP engine, against an archive built in the test: the mark of the engine itself, a
// graph of two nodes of the classes the engine knows (a picture and a sound), the manifest of the game behind
// them, and the places of the two objects. The detection of a file that carries neither the mark nor an
// `.ici` payload beside it, and the refusal of an archive whose graph does not stand, are pinned beside it.
import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { rioFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

/** The places of the two objects of the archive of the test. */
function run(count: number, base: number, addend: number): Buffer {
	return Buffer.from(
		[...Array(count).keys()].map((at) => (at * base + addend) & 0xff),
	);
}

const PICTURE_PAYLOAD = run(0x20, 5, 1);
const SOUND_PAYLOAD = run(0x10, 3, 2);

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

/** A count of thirty two places. */
function i32(value: number): Buffer {
	const out = Buffer.alloc(4, 0x00);
	out.writeInt32LE(value, 0);
	return out;
}

/** A class of the stream itself: the tag, the schema and the name. */
function runtimeClass(name: string, schema = 0x10): Buffer {
	const body = Buffer.alloc(4 + name.length, 0x00);
	body.writeUInt16LE(schema, 0);
	body.writeUInt16LE(name.length, 2);
	body.write(name, 4, "latin1");
	return Buffer.concat([rioCount(0xffff), body]);
}

/** The head of a manifest of the engine, of the class of it and the count of the nodes behind it. */
function manifestHead(nodes: number): Buffer {
	return Buffer.concat([
		Buffer.from("cd326e59", "hex"),
		rioCount(0x10),
		runtimeClass("CObjectArcMan"),
		rioCount(nodes),
	]);
}

/** The places of the least of the walks of the manifest of the engine, of no archive behind it. */
function manifestBody(): Buffer {
	return Buffer.concat([
		i32(5),
		i32(0x1873be26),
		Buffer.from([0, 0]),
		i32(0),
		i32(0),
		i32(0),
		rioStr("a game of the engine"),
		i32(0),
		rioStr(""),
		i32(0),
		rioStr(""),
		rioStr(""),
		rioStr(""),
		i32(0),
		rioStr(""),
		rioCount(0),
		i32(0),
		i32(0x30),
		rioCount(0),
	]);
}

/** One node of the graph: the places of the object behind it, and the class of the object. */
function node(className: string, offset: number, size: number): Buffer {
	return Buffer.concat([
		rioCount(0x0008),
		rioCount(0),
		runtimeClass(className),
		i32(offset),
		i32(size),
		rioCount(0),
	]);
}

/** An archive of the engine of the two objects, of the places the two of them stand at. */
function rioArchive(places: { picture: number; sound: number }): Buffer {
	return Buffer.concat([
		manifestHead(2),
		rioStr("picture.s5i"),
		node("CS5i", places.picture, PICTURE_PAYLOAD.length),
		rioStr("sound.wav"),
		node("CWaveAudio", places.sound, SOUND_PAYLOAD.length),
		manifestBody(),
		PICTURE_PAYLOAD,
		SOUND_PAYLOAD,
	]);
}

/** The archive of the test, of the places of its two objects read off the head of it. */
function buildRio(): Buffer {
	const placeholder = rioArchive({ picture: 0, sound: 0 });
	const base =
		placeholder.length - PICTURE_PAYLOAD.length - SOUND_PAYLOAD.length;
	return rioArchive({ picture: base, sound: base + PICTURE_PAYLOAD.length });
}

describe("rUGP resource archive", () => {
	it("lists and reads the objects of a graph the engine knows", async () => {
		await expectArchive({
			format: rioFormat,
			archive: buildRio(),
			sourcePath: "sample.rio",
			entries: [
				{
					path: "picture.s5i",
					size: PICTURE_PAYLOAD.length,
					content: PICTURE_PAYLOAD,
				},
				{
					path: "sound.wav",
					size: SOUND_PAYLOAD.length,
					content: SOUND_PAYLOAD,
				},
			],
			metadata: { entryCount: 2, version: 5 },
		});
	});

	it("names the kind of the class of every entry", async () => {
		const source = new BufferByteSource(buildRio());
		const archive = await rioFormat.open(source, "sample.rio");
		try {
			expect(archive.entries.map((entry) => entry.metadata?.["kind"])).toEqual([
				"image",
				"audio",
			]);
			expect(
				archive.entries.map((entry) => entry.metadata?.["className"]),
			).toEqual(["CS5i", "CWaveAudio"]);
		} finally {
			await archive.close();
		}
	});

	it("turns away a file of no graph of this engine", async () => {
		// A file that carries neither the mark of the engine nor an `.ici` payload beside it is not an archive
		// of it at all, and a mark of no graph behind it is named as the piece this port does not walk.
		await expectArchive({
			format: rioFormat,
			archive: Buffer.from("nothing of the engine at all", "latin1"),
			sourcePath: "sample.rio",
			entries: [],
			detected: false,
		});
		const marked = Buffer.concat([
			Buffer.from("cd326e59", "hex"),
			Buffer.from("nothing of the engine at all", "latin1"),
		]);
		const source = new BufferByteSource(marked);
		expect(await rioFormat.detect(source, "sample.rio")).toBe(true);
		await expect(rioFormat.open(source, "sample.rio")).rejects.toThrow(
			/stands behind no graph/,
		);
	});
});
