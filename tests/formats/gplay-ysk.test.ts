import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { yskFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
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
