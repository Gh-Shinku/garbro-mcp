import { BufferByteSource } from "@garbro-mcp/core";
import { nsOpenerFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const KEY = 0x84;
const PLAIN = Buffer.from("*define\r\n*start\r\ngame\r\n", "latin1");

/** The mask is its own inverse. */
function mask(input: Buffer): Buffer {
	const output: Buffer = Buffer.alloc(input.length);
	for (let i = 0; i < input.length; i += 1) output[i] = (input[i] ?? 0) ^ KEY;
	return output;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("nscripter script", () => {
	it("unmasks the script named nscript.dat", async () => {
		const file = mask(PLAIN);
		const source = sourceOf(file);
		expect(await nsOpenerFormat.detect(source, "/game/nscript.dat")).toBe(true);
		const archive = await nsOpenerFormat.open(source, "/game/nscript.dat");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"nscript.txt",
			]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "script" });
			expect(archive.metadata).toMatchObject({ script: "nscripter", key: KEY });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			// The mask preserves the length.
			expect(Number(entry.size)).toBe(file.length);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				PLAIN,
			);
		} finally {
			await archive.close();
		}
	});

	it("accepts the file name in any case", async () => {
		expect(
			await nsOpenerFormat.detect(
				sourceOf(mask(PLAIN)),
				"C:\\GAME\\NSCRIPT.DAT",
			),
		).toBe(true);
	});

	it("declines another file name", async () => {
		expect(
			await nsOpenerFormat.detect(sourceOf(mask(PLAIN)), "/game/script.dat"),
		).toBe(false);
		expect(
			await nsOpenerFormat.detect(sourceOf(mask(PLAIN)), "/game/nscript2.dat"),
		).toBe(false);
	});

	it("declines an empty file", async () => {
		expect(
			await nsOpenerFormat.detect(
				sourceOf(Buffer.alloc(0)),
				"/game/nscript.dat",
			),
		).toBe(false);
	});
});
