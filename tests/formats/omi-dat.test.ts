import { encryptOmiRange, omiDatFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

/**
 * Builds a `scrdat` file: a text index of one count line and a name and size line per entry, then the
 * payloads, all encrypted as one continuous range because the cipher advances per byte.
 */
function buildOmi(
	entries: readonly { name: string; payload: Buffer; size: number }[],
): Buffer {
	const header = Buffer.from(`${entries.length}\n`, "latin1");
	const indexParts: Buffer[] = [];
	for (const entry of entries)
		indexParts.push(Buffer.from(`${entry.name}\n${entry.size}\n`, "latin1"));
	const index = Buffer.concat([header, ...indexParts]);
	const body = Buffer.concat(entries.map((entry) => entry.payload));
	const archive = Buffer.concat([index, body]);
	return encryptOmiRange(Buffer.from(archive), 0);
}

/** An RLE block: an output length in sixteen-bit units, a marker, then words and repeats. */
function rleBlock(outputUnits: number, words: readonly Buffer[]): Buffer {
	const header = Buffer.alloc(6);
	header.writeInt32LE(outputUnits, 0);
	header.writeUInt16LE(0x1234, 4);
	return Buffer.concat([header, ...words]);
}

function word(value: number): Buffer {
	const buffer = Buffer.alloc(2);
	buffer.writeUInt16LE(value, 0);
	return buffer;
}

describe("OMI Script Engine DAT archive", () => {
	it("decrypts its text index and stored payloads", async () => {
		const first = Buffer.from("plain body");
		await expectArchive({
			format: omiDatFormat,
			archive: buildOmi([
				{ name: "script.txt", payload: first, size: first.length },
			]),
			sourcePath: "scrdat",
			entries: [{ path: "script.txt", size: first.length, content: first }],
		});
	});

	it("expands packed image payloads with the RLE helper", async () => {
		// One plain word, then a marker with the word to repeat and a count of three, which yields two
		// repeats of that word behind it.
		const block = rleBlock(4, [
			word(0x1111),
			word(0x1234),
			word(0x5678),
			word(0x0003),
		]);
		const expected = Buffer.concat([
			word(0x1111),
			word(0x5678),
			word(0x5678),
			word(0x5678),
		]);
		await expectArchive({
			format: omiDatFormat,
			archive: buildOmi([
				{ name: "image.bmp", payload: block, size: block.length },
			]),
			sourcePath: "scrdat",
			// The listed size is the stored span; the extracted payload is the RLE output.
			entries: [{ path: "image.bmp", size: block.length, content: expected }],
		});
	});

	it("requires the exact scrdat file name", async () => {
		const payload = Buffer.from("body");
		await expectArchive({
			format: omiDatFormat,
			archive: buildOmi([{ name: "a.txt", payload, size: payload.length }]),
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});

	it("rejects a count that does not match the lines", async () => {
		const payload = Buffer.from("body");
		const archive = buildOmi([
			{ name: "a.txt", payload, size: payload.length },
		]);
		const decrypted = encryptOmiRange(Buffer.from(archive), 0);
		decrypted.write("9", 0, "latin1");
		await expectArchive({
			format: omiDatFormat,
			archive: encryptOmiRange(decrypted, 0),
			sourcePath: "scrdat",
			detected: false,
			entries: [],
		});
	});
});
