import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	readScrLayout,
	scrScriptFormat,
	unpackScrScript,
} from "../../packages/formats/src/amaterasu/scr-script.js";

const HEAD_SIZE = 0x0c;
const RECORD_SIZE = 0x0c;

function script(
	type: number,
	lines: { id: number; text: Buffer; offset?: number; size?: number }[],
): Buffer {
	const head = Buffer.alloc(HEAD_SIZE + lines.length * RECORD_SIZE, 0x00);
	head.write("SCR\0", 0, "latin1");
	head.writeUInt32LE(type, 4);
	head.writeUInt32LE(lines.length, 8);
	const texts: Buffer[] = [];
	let at = head.length;
	lines.forEach((line, i) => {
		head.writeUInt32LE(line.offset ?? at, HEAD_SIZE + i * RECORD_SIZE);
		head.writeInt32LE(
			line.size ?? line.text.length,
			HEAD_SIZE + i * RECORD_SIZE + 4,
		);
		head.writeUInt32LE(line.id, HEAD_SIZE + i * RECORD_SIZE + 8);
		if (line.offset === undefined) {
			texts.push(line.text);
			at += line.text.length;
		}
	});
	return Buffer.concat([head, ...texts]);
}

describe("Amaterasu game engine script format", () => {
	it("reads the places of the picture of the walk of the places of the picture of the words of the walk of the places of the picture of a script of this kind", () => {
		const file = script(1, [
			{ id: 0x10, text: Buffer.from("first", "latin1") },
			{ id: 0x20, text: Buffer.from("second", "latin1") },
		]);
		const layout = readScrLayout(file);
		if (!layout) throw new Error("no layout");
		expect(layout.type).toBe(1);
		expect(layout.lines.length).toBe(2);
		expect(layout.lines[0]).toEqual({ id: 0x10, text: "first" });
		expect(layout.lines[1]).toEqual({ id: 0x20, text: "second" });
		expect(unpackScrScript(file)).toBe("first\nsecond\n");
	});

	it("stands the places of the picture of the walk of the places of the picture of the text of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of them of the engine", () => {
		const file = script(2, [
			{ id: 1, text: Buffer.from([0x83, 0x41]) },
			{ id: 2, text: Buffer.from("ok", "latin1") },
		]);
		expect(unpackScrScript(file)).toBe("\u30a2\nok\n");
	});

	it("stands the places of the picture of the walk of the places of the picture of the text of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of them of the engine behind the places of the picture of the walk of the places of the picture of the words of the walk of the places of the picture of the walk of them", () => {
		const file = script(0, [
			{ id: 7, text: Buffer.from("late", "latin1"), offset: 0x40 },
		]);
		const padded = Buffer.concat([
			file,
			Buffer.alloc(0x40 - file.length, 0x00),
			Buffer.from("late", "latin1"),
		]);
		const layout = readScrLayout(padded);
		if (!layout) throw new Error("no layout");
		expect(layout.lines[0]).toEqual({ id: 7, text: "late" });
	});

	it("turns away the places of the picture of the walk of the places of the picture of the words of the walk of the place of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of this kind", () => {
		const good = script(1, [{ id: 1, text: Buffer.from("hi", "latin1") }]);
		const wrong = Buffer.from(good);
		wrong.write("XXX\0", 0, "latin1");
		expect(readScrLayout(wrong)).toBeUndefined();
		expect(readScrLayout(Buffer.alloc(8, 0x00))).toBeUndefined();
		const far = Buffer.from(good);
		far.writeUInt32LE(0x1000, HEAD_SIZE);
		expect(readScrLayout(far)).toBeUndefined();
		const long = Buffer.from(good);
		long.writeInt32LE(0x100, HEAD_SIZE + 4);
		expect(readScrLayout(long)).toBeUndefined();
		const many = Buffer.from(good);
		many.writeUInt32LE(0x1000, 8);
		expect(readScrLayout(many)).toBeUndefined();
		const empty = script(3, []);
		const emptyLayout = readScrLayout(empty);
		if (!emptyLayout) throw new Error("no empty layout");
		expect(emptyLayout.lines).toEqual([]);
		expect(unpackScrScript(empty)).toBe("\n");
	});

	it("stands the places of the picture of the walk of the places of the picture of the text of a script of this kind out as the places of the picture of the walk of them", async () => {
		const file = script(1, [
			{ id: 1, text: Buffer.from("one", "latin1") },
			{ id: 2, text: Buffer.from("two", "latin1") },
		]);
		const archive = await scrScriptFormat.open(
			new BufferByteSource(file),
			"scripts/00000001.scr",
		);
		const entry = archive.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry.path).toBe("00000001.txt");
		expect(archive.metadata).toMatchObject({
			script: "scr/ami",
			scriptType: 1,
			lines: 2,
		});
		const text = await consumeBuffer(await archive.openEntry(entry.id));
		expect(text.toString("utf8")).toBe("one\ntwo\n");
	});

	it("is told by the words of the picture of the walk of the places of the picture", async () => {
		expect(scrScriptFormat.descriptor.id).toBe("amaterasu-scr-script");
		const file = script(1, [{ id: 1, text: Buffer.from("hi", "latin1") }]);
		await expect(
			scrScriptFormat.detect(new BufferByteSource(file)),
		).resolves.toBe(true);
		await expect(
			scrScriptFormat.detect(new BufferByteSource(Buffer.alloc(64, 0x00))),
		).resolves.toBe(false);
		await expect(
			scrScriptFormat.open(
				new BufferByteSource(Buffer.alloc(64, 0x00)),
				"00000001.scr",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
