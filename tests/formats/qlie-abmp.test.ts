import { abmp7Format, abmpFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const TAG_SIZE = 0x10;
const INDEX_OFFSET = 0x10;
const MARKER = Buffer.from([0x31, 0x50, 0x43, 0xff]);

/** A tag is a sixteen-byte field, not necessarily filled. */
function tag(name: string): Buffer {
	const field = Buffer.alloc(TAG_SIZE);
	field.write(name, 0, "latin1");
	return field;
}

function word(value: number): Buffer {
	const buffer = Buffer.alloc(4);
	buffer.writeUInt32LE(value, 0);
	return buffer;
}

/** The head carries the signature, a two-byte version word and a zero byte. */
function head(signature: string, version: string): Buffer {
	const header = Buffer.alloc(INDEX_OFFSET);
	header.write(signature, 0, "ascii");
	header.write(version, 4, "latin1");
	return header;
}

/** A pack stream holding the given bytes as literals through an identity alphabet. */
function packStream(body: Buffer): Buffer {
	const table: number[] = [];
	for (let start = 0; start < 256; start += 128) {
		table.push(127);
		for (let slot = start; slot < start + 128; slot += 1) table.push(slot);
	}
	const header = Buffer.alloc(12);
	MARKER.copy(header, 0);
	header.writeUInt32LE(body.length, 8);
	return Buffer.concat([header, Buffer.from(table), word(body.length), body]);
}

describe("QLIE ABMP resource archives", () => {
	it("reads plain data records and image containers", async () => {
		const plain = Buffer.from("plain body");
		const packed = Buffer.from("packed body");
		const unicode = Buffer.from("named", "utf16le");
		const wide = Buffer.alloc(2);
		wide.writeUInt16LE(unicode.length / 2, 0);
		const narrow = Buffer.alloc(2);
		narrow.writeUInt16LE(0, 0);
		const container = Buffer.concat([
			tag("abimage10"),
			Buffer.from([1]),
			tag("abimgdat15"),
			word(1),
			wide,
			unicode,
			narrow,
			Buffer.from([0]),
			Buffer.alloc(0x11),
			word(packed.length),
			packed,
		]);
		const archive = Buffer.concat([
			head("abmp", "11"),
			tag("abdata"),
			word(plain.length),
			plain,
			container,
		]);
		await expectArchive({
			format: abmpFormat,
			archive,
			sourcePath: "sample.b",
			entries: [
				{ path: "sample#0.dat", size: plain.length, content: plain },
				{ path: "named", size: packed.length, content: packed },
			],
		});
	});

	it("expands a payload that begins with the pack marker", async () => {
		const body = Buffer.from("expanded body");
		const stream = packStream(body);
		const plain = Buffer.from("plain body");
		const archive = Buffer.concat([
			head("abmp", "12"),
			tag("abdata"),
			word(stream.length),
			stream,
			tag("abdata"),
			word(plain.length),
			plain,
		]);
		await expectArchive({
			format: abmpFormat,
			archive,
			sourcePath: "sample.b",
			entries: [
				{ path: "sample#0.dat", size: stream.length, content: body },
				{ path: "sample#1.dat", size: plain.length, content: plain },
			],
		});
	});

	it("rejects an unsupported version", async () => {
		const archive = Buffer.concat([
			head("abmp", "13"),
			tag("abdata"),
			word(1),
			Buffer.from("x"),
		]);
		await expectArchive({
			format: abmpFormat,
			archive,
			sourcePath: "sample.b",
			detected: false,
			entries: [],
		});
	});

	it("requires the b extension", async () => {
		const archive = Buffer.concat([
			head("abmp", "11"),
			tag("abdata"),
			word(1),
			Buffer.from("x"),
		]);
		await expectArchive({
			format: abmpFormat,
			archive,
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});

	it("reads version seven frames behind their size words", async () => {
		const first = Buffer.from("first frame");
		const second = Buffer.from("second frame");
		const header = Buffer.alloc(0x10);
		header.write("ABMP", 0, "ascii");
		header.writeUInt16LE(0x37, 4);
		header.writeUInt32LE(first.length, 0x0c);
		const archive = Buffer.concat([
			header,
			first,
			word(second.length),
			second,
			word(0),
		]);
		await expectArchive({
			format: abmp7Format,
			archive,
			sourcePath: "sample.abmp",
			entries: [
				{ path: "sample#0.dat", size: first.length, content: first },
				{ path: "sample#1", size: second.length, content: second },
			],
		});
	});

	it("rejects a version seven head without its digit", async () => {
		const header = Buffer.alloc(0x10);
		header.write("ABMP", 0, "ascii");
		header.writeUInt16LE(0x38, 4);
		header.writeUInt32LE(1, 0x0c);
		await expectArchive({
			format: abmp7Format,
			archive: Buffer.concat([header, Buffer.from("x"), word(0)]),
			sourcePath: "sample.abmp",
			detected: false,
			entries: [],
		});
	});
});
