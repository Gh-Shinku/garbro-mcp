import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { yskFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { GplayDes } from "../../packages/formats/src/gplay/des.js";
import { readYskIndex } from "../../packages/formats/src/gplay/ysk.js";

/** The head of an archive of the engine: the letters `AA`, the places of the version and the places of the file. */
function yskFile(
	version: string,
	entries: { name: string; body: Buffer }[],
): Buffer {
	const head: Buffer = Buffer.alloc(0x10, 0x00);
	head.write("AA", 0, "latin1");
	head.write(version, 2, "latin1");
	head.writeInt32LE(entries.length, 12);
	const index: Buffer[] = [];
	const data: Buffer[] = [];
	for (const entry of entries) {
		const field: Buffer = Buffer.alloc(0x18, 0x00);
		field.write(entry.name, 0, "latin1");
		field.writeUInt32LE(entry.body.length, 0x14);
		index.push(field);
		data.push(entry.body);
	}
	return Buffer.concat([head, ...index, ...data]);
}

/** The places of the file of an entry of the archive, of the walk of the places of the file of it. */
async function entryOf(data: Buffer, at: number): Promise<Buffer> {
	const handle = await yskFormat.open(new BufferByteSource(data), "cg.ysk");
	const entry = handle.entries[at];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

it("walks the places of the file of the cipher of the engine", () => {
	// The places of the file of the walk of the cipher of this port and of a walk of the same reference
	// written apart from it stand of the same places of the file: the key of the engine itself stands of
	// `1234567812345678`, of the places of the file of the walk of the engine.
	const des = new GplayDes(0x1234567812345678n);
	expect(des.transformQWord(0x1122334455667788n).toString(16)).toBe(
		"d09828a88801a6ba",
	);
	const places = Buffer.from("0011223344556677", "hex");
	des.transform(places, 0, places.length);
	expect([...places]).toEqual([...Buffer.from("f5041a9148a9926e", "hex")]);
	const part = Buffer.from("aabbccdd", "hex");
	des.transform(part, 0, part.length);
	expect([...part]).toEqual([...Buffer.from("f6472bd0", "hex")]);
	// The walk of the places of the file of the cipher of the engine stands of the places of the file of
	// the key of it: the places of the file of the walk of the engine of this port and of a walk of the
	// same reference written apart from it stand of the same places of the file of the keys of the game
	// of the engine itself.
	const other = new GplayDes(0xdeadbeefcafebaben);
	expect(other.transformQWord(0x1122334455667788n).toString(16)).toBe(
		"b7031d97614b8a6f",
	);
	expect(other.transformQWord(0x0123456789abcdefn).toString(16)).toBe(
		"8aeabfd2ad2dbc43",
	);
	const third = new GplayDes(0x0f1e2d3c4b5a6978n);
	expect(third.transformQWord(0xffffffffffffffffn).toString(16)).toBe(
		"3c21a023caa1a9ff",
	);
	expect(third.transformQWord(0x0000000000000000n).toString(16)).toBe(
		"46c6b622077ed9bf",
	);
});

it("reads the places of the file of the text of the archive, of the cipher of the engine", async () => {
	const data = yskFile("1640124080", [
		{ name: "a.txt", body: Buffer.from("0011223344556677", "hex") },
		{ name: "b.dat", body: Buffer.from("#plain!!", "latin1") },
		{ name: "c.ogg", body: Buffer.from("0011223344556677", "hex") },
	]);
	expect([...(await entryOf(data, 0))]).toEqual([
		...Buffer.from("f5041a9148a9926e", "hex"),
	]);
	expect([...(await entryOf(data, 1))]).toEqual([
		...Buffer.from("#plain!!", "latin1"),
	]);
	expect([...(await entryOf(data, 2))]).toEqual([
		...Buffer.from("0011223344556677", "hex"),
	]);
});

it("reads the places of the file of a picture of the archive, of the cipher of the engine", async () => {
	// The places of the file of a picture of the engine stand of the places of the file of the cipher of
	// the engine of the eight first places of the file of every block of 0x1000 places of them.
	const jpg = Buffer.concat([
		Buffer.from("ffd8ffe000104a46", "hex"),
		Buffer.from("aabbccdd", "hex"),
	]);
	const data = yskFile("1640124080", [{ name: "a.jpg", body: jpg }]);
	expect([...(await entryOf(data, 0))]).toEqual([
		...Buffer.from("3e11559bd2709f62", "hex"),
		...Buffer.from("aabbccdd", "hex"),
	]);
});

it("reads the places of the file of the BMP of the archive, of the places of it of the engine", async () => {
	// The places of the file of the BMP of the engine stand of the places of a colour of a place of the
	// picture of the walk of the engine itself: the places of the file of the walk of the places of the
	// picture of a picture of no places of a colour of eight of them stand of eight of them.
	const small: Buffer = Buffer.alloc(0x100, 0x00);
	small.writeUInt16LE(4, 0x1c);
	const data = yskFile("1640124080", [{ name: "a.bmp", body: small }]);
	const content = await entryOf(data, 0);
	expect(content.readUInt16LE(0x1c)).toBe(8);
	const big: Buffer = Buffer.alloc(0x36 + 0x493aa + 0x200, 0x00);
	big.writeUInt16LE(16, 0x1c);
	big.set(Buffer.from("0102030405060708", "hex"), 0x36 + 0x493aa);
	const other = yskFile("1640124080", [{ name: "b.bmp", body: big }]);
	const places = await entryOf(other, 0);
	expect(places.readUInt16LE(0x1c)).toBe(24);
	expect([...places.subarray(0x36 + 0x493aa, 0x36 + 0x493aa + 8)]).toEqual([
		...Buffer.from("55577b3611c02321", "hex"),
	]);
});

describe("GPlay engine resource archive", () => {
	it("reads the index of the archive of the places of the file of the entries of it", () => {
		const data = yskFile("1640124080", [
			{ name: "a.txt", body: Buffer.alloc(8, 0x00) },
			{ name: "b.ogg", body: Buffer.alloc(4, 0x00) },
		]);
		const entries = readYskIndex(data);
		expect(entries?.length).toBe(2);
		expect(entries?.[0]?.name).toBe("a.txt");
		expect(entries?.[0]?.offset).toBe(0x10n + 2n * 0x18n);
		expect(entries?.[0]?.size).toBe(8);
		expect(entries?.[0]?.kind).toBe("text");
		expect(entries?.[1]?.offset).toBe(0x10n + 2n * 0x18n + 8n);
		expect(entries?.[1]?.kind).toBe("raw");
		expect(readYskIndex(Buffer.alloc(0x10, 0x00))).toBeUndefined();
		expect(
			readYskIndex(
				yskFile("16401240XX", [{ name: "a.txt", body: Buffer.alloc(8) }]),
			),
		).toBeUndefined();
		// The places of the file of an entry stand of the places of the file of the archive of it.
		const short = yskFile("1640124080", [
			{ name: "a.txt", body: Buffer.alloc(4) },
		]);
		short.writeUInt32LE(0x40, 0x10 + 0x14);
		expect(readYskIndex(short)).toBeUndefined();
	});

	it("tells an archive of the engine by the head of it, and turns away the ones that stand of no index", async () => {
		const data = yskFile("1640124080", [
			{ name: "a.txt", body: Buffer.alloc(8) },
		]);
		expect(await yskFormat.detect?.(new BufferByteSource(data))).toBe(true);
		const wrong = Buffer.from(data);
		wrong.write("BB", 0, "latin1");
		expect(await yskFormat.detect?.(new BufferByteSource(wrong))).toBe(false);
		await expect(
			yskFormat.open(new BufferByteSource(wrong), "cg.ysk"),
		).rejects.toThrow(GarbroError);
	});
});
