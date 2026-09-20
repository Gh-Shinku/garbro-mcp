import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	gscFormat,
	readGscLayout,
	unpackGscScript,
} from "../../packages/formats/src/liar/gsc.js";

const HEAD_SIZE = 0x14;
const MOST_HEAD = 0x24;

function script(options: {
	header?: Buffer;
	code?: Buffer;
	texts: Buffer[];
	index?: number[];
	footer?: Buffer;
	head?: number;
	length?: number;
	indexSize?: number;
	textSize?: number;
}): Buffer {
	const header = options.header ?? Buffer.alloc(0);
	const code = options.code ?? Buffer.alloc(0);
	const texts = options.texts;
	const textSize =
		options.textSize ?? texts.reduce((sum, text) => sum + text.length, 0);
	const index =
		options.index ??
		texts.reduce<number[]>((out, text, at) => {
			if (at === 0) out.push(0);
			else out.push((out[at - 1] ?? 0) + (texts[at - 1]?.length ?? 0));
			return out;
		}, []);
	const indexBuffer = Buffer.alloc(index.length * 4, 0x00);
	index.forEach((value, at) => {
		indexBuffer.writeUInt32LE(value, at * 4);
	});
	const footer = options.footer ?? Buffer.alloc(0);
	const text = Buffer.concat(texts);
	const body = Buffer.concat([
		Buffer.alloc(HEAD_SIZE, 0x00),
		header,
		code,
		indexBuffer,
		text,
		footer,
	]);
	body.writeUInt32LE(options.head ?? HEAD_SIZE + header.length, 4);
	body.writeUInt32LE(code.length, 8);
	body.writeUInt32LE(options.indexSize ?? indexBuffer.length, 0x0c);
	body.writeUInt32LE(textSize, 0x10);
	body.writeUInt32LE(options.length ?? body.length, 0);
	return body;
}

function cstring(text: string): Buffer {
	return Buffer.concat([Buffer.from(text, "latin1"), Buffer.alloc(1, 0x00)]);
}

describe("Liar game engine script format", () => {
	it("reads the places of the picture of the walk of the places of the picture of the text of a script of this kind", () => {
		const file = script({ texts: [cstring("hello"), cstring("world")] });
		const layout = readGscLayout(file);
		if (!layout) throw new Error("no layout");
		expect(layout.headerSize).toBe(HEAD_SIZE);
		expect(layout.codeSize).toBe(0);
		expect(layout.textSize).toBe(12);
		expect(layout.footerAt).toBe(file.length);
		expect(layout.index).toEqual([0, 6]);
		expect(unpackGscScript(file)).toBe("hello\nworld\n");
	});

	it("stands the places of the picture of the walk of the places of the picture of the words of the walk of the picture of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of them", () => {
		const file = script({
			header: Buffer.from([0x01, 0x02, 0x03, 0x04]),
			code: Buffer.from([0xaa, 0xbb]),
			texts: [cstring("ab"), Buffer.from([0x00, 0x00]), cstring("cd")],
			index: [0, 5],
			textSize: 8,
			footer: Buffer.from([0xde, 0xad]),
		});
		const layout = readGscLayout(file);
		if (!layout) throw new Error("no layout");
		expect(layout.headerSize).toBe(HEAD_SIZE + 4);
		expect(layout.code).toEqual(Buffer.from([0xaa, 0xbb]));
		expect(layout.header).toEqual(Buffer.from([0x01, 0x02, 0x03, 0x04]));
		expect(layout.index).toEqual([0, 5]);
		expect(layout.footerAt).toBe(file.length - 2);
		expect(unpackGscScript(file)).toBe("ab\ncd\n");
	});

	it("stands the places of the picture of the walk of the places of the picture of the text of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of them of the engine", () => {
		const file = script({
			texts: [
				Buffer.concat([Buffer.from([0x83, 0x41]), Buffer.alloc(1, 0x00)]),
			],
		});
		expect(unpackGscScript(file)).toBe("\u30a2\n");
	});

	it("turns away the places of the picture of the walk of the places of the picture of the words of the walk of the picture that stand of no places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of them of the engine", () => {
		expect(readGscLayout(script({ texts: [], length: 0x40 }))).toBeUndefined();
		expect(readGscLayout(script({ texts: [], head: 0x13 }))).toBeUndefined();
		expect(
			readGscLayout(script({ texts: [], head: MOST_HEAD + 1 })),
		).toBeUndefined();
		expect(
			readGscLayout(script({ texts: [cstring("ab")], index: [0x40] })),
		).toBeUndefined();
		expect(readGscLayout(Buffer.alloc(8, 0x00))).toBeUndefined();
		const long = script({ texts: [cstring("ab")] });
		expect(readGscLayout(long.subarray(0, long.length - 3))).toBeUndefined();
	});

	it("stands the places of the picture of the walk of the places of the picture of the text of a script of this kind out as the places of the picture of the walk of them", async () => {
		const file = script({ texts: [cstring("one"), cstring("two")] });
		const archive = await gscFormat.open(
			new BufferByteSource(file),
			"script.gsc",
		);
		const entry = archive.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry.path).toBe("script.txt");
		expect(archive.metadata).toMatchObject({ script: "gsc", lines: 2 });
		const text = await consumeBuffer(await archive.openEntry(entry.id));
		expect(text.toString("utf8")).toBe("one\ntwo\n");
	});

	it("stands the places of the picture of the walk of the places of the picture of the words of the walk of the picture of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of them", async () => {
		expect(gscFormat.descriptor.id).toBe("liar-gsc-script");
		const file = script({ texts: [cstring("hi")] });
		await expect(
			gscFormat.detect(new BufferByteSource(file), "script.gsc"),
		).resolves.toBe(true);
		await expect(
			gscFormat.detect(new BufferByteSource(Buffer.alloc(HEAD_SIZE, 0x00))),
		).resolves.toBe(false);
		await expect(
			gscFormat.open(
				new BufferByteSource(Buffer.alloc(HEAD_SIZE, 0x00)),
				"script.gsc",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
