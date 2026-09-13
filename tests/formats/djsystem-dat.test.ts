import { djDatFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const ENCODE_HEADER = "DJCODE NLINE-ENCODE\n";
const NO_ENCODE_HEADER = "DJCODE NLINE-NO-ENCODE\n";

interface DjEntry {
	name: string;
	stored: Buffer;
}

/** Builds a text index plus payloads; offsets are absolute within the same file. */
function buildDj(entries: readonly DjEntry[]): Buffer {
	const header = "FILECMB-DATA-LIST-IN\n";
	const terminator = "LIST-END\r\n";
	const line = (name: string, start: number, end: number): string =>
		`${name}\t${String(start).padStart(10, "0")}\t${String(end).padStart(
			10,
			"0",
		)}\r\n`;
	// Zero-padded offsets keep every line the same width, so the first pass sizes the index.
	let lines = "";
	let offset = header.length;
	for (const entry of entries) {
		lines += line(entry.name, offset, offset + entry.stored.length);
		offset += entry.stored.length;
	}
	const base = header.length + lines.length + terminator.length;
	lines = "";
	offset = base;
	for (const entry of entries) {
		lines += line(entry.name, offset, offset + entry.stored.length);
		offset += entry.stored.length;
	}
	return Buffer.concat([
		Buffer.from(`${header}${lines}${terminator}`, "latin1"),
		...entries.map((entry) => entry.stored),
	]);
}

/** Encrypts a script the way the `ENCODE` variant stores it. */
function encodeScript(text: string): Buffer {
	const body = Buffer.from(text, "latin1");
	for (let position = 0; position < body.length; position += 1)
		body[position] = (body[position] ?? 0) ^ 0xff;
	return Buffer.concat([Buffer.from(ENCODE_HEADER, "latin1"), body]);
}

/** Encrypts a script the way the `NO-ENCODE` variant stores it. */
function noEncodeScript(text: string): Buffer {
	const body = Buffer.from(text, "latin1");
	for (let position = 0; position < body.length; position += 1)
		body[position] = (body[position] ?? 0) ^ 0xff;
	return Buffer.concat([Buffer.from(NO_ENCODE_HEADER, "latin1"), body]);
}

describe("DJSYSTEM engine DAT resource archive", () => {
	it("reads a text index and unwraps ENCODE scripts", async () => {
		const plain = "print 'hello';";
		const raw = Buffer.from("plain payload");
		await expectArchive({
			format: djDatFormat,
			archive: buildDj([
				{ name: "main.djs", stored: encodeScript(plain) },
				{ name: "image.bmp", stored: raw },
			]),
			sourcePath: "game.dat",
			entries: [
				{
					path: "main.djs",
					size: Buffer.byteLength(plain),
					content: Buffer.from(plain, "latin1"),
				},
				{ path: "image.bmp", size: raw.length, content: raw },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("unwraps NO-ENCODE scripts with their CRLF collapse", async () => {
		const plain = "line one\r\nline two";
		// Only the LF bytes survive; the CR bytes are dropped before the XOR.
		const storedBody = Buffer.alloc(plain.length);
		let length = 0;
		for (let position = 0; position < plain.length; position += 1) {
			const value = plain.charCodeAt(position) & 0xff;
			if (value === 0x0d && (plain.charCodeAt(position + 1) & 0xff) === 0x0a)
				continue;
			storedBody[length] = value ^ 0xff;
			length += 1;
		}
		const stored = Buffer.concat([
			Buffer.from(NO_ENCODE_HEADER, "latin1"),
			storedBody.subarray(0, length),
		]);
		await expectArchive({
			format: djDatFormat,
			archive: buildDj([{ name: "scene.djs", stored }]),
			sourcePath: "game.dat",
			entries: [
				{
					path: "scene.djs",
					size: Buffer.byteLength(plain) - 1,
					content: Buffer.from("line one\nline two", "latin1"),
				},
			],
			metadata: { entryCount: 1, decodedEntryCount: 1 },
		});
	});

	it("rejects a missing marker line", async () => {
		const archive = buildDj([{ name: "a.bin", stored: Buffer.from("x") }]);
		archive.write("FILEXXXX-DATA-LIST-IN\n", 0, "latin1");
		await expectArchive({
			format: djDatFormat,
			archive,
			sourcePath: "game.dat",
			detected: false,
			entries: [],
		});
	});
});
