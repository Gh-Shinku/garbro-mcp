import { encodeCp932 } from "@garbro-mcp/core";
import { iflFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 12;
const RECORD_SIZE = 0x18;

interface Entry {
	name: string;
	payload: Buffer;
}

/** The head holds the signature, a data offset and a count, then the records and the payloads. */
function buildIfl(entries: readonly Entry[], dataOffset = 0): Buffer {
	const indexSize = entries.length * RECORD_SIZE;
	const payloadStart = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		payloadStart +
			entries.reduce((sum, entry) => sum + entry.payload.length, 0),
	);
	archive.write("IFLS", 0, "ascii");
	archive.writeUInt32LE(dataOffset === 0 ? payloadStart : dataOffset, 4);
	archive.writeInt32LE(entries.length, 8);
	let position = payloadStart;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(position, record + 0x10);
		archive.writeUInt32LE(entry.payload.length, record + 0x14);
		entry.payload.copy(archive, position);
		position += entry.payload.length;
	}
	return archive;
}

/** A packed payload: the marker, the expanded length, and an LZSS stream behind the twelve-byte header. */
function packed(expandedSize: number, stream: Buffer): Buffer {
	const header = Buffer.alloc(12);
	header.write("CMP_", 0, "ascii");
	header.writeUInt32LE(expandedSize, 4);
	return Buffer.concat([header, stream]);
}

describe("Silky IFL resource archive", () => {
	it("reads a stored payload and expands a marked one", async () => {
		const stored = Buffer.from("stored body");
		// With the ring fill this format uses, the literal 'A' followed by a match at distance one gives five.
		const stream = Buffer.from([0x01, 0x41, 0xee, 0xf1]);
		await expectArchive({
			format: iflFormat,
			archive: buildIfl([
				{ name: "one.dat", payload: stored },
				{ name: "two.dat", payload: packed(5, stream) },
			]),
			sourcePath: "sample.ifl",
			entries: [
				{ path: "one.dat", size: stored.length, content: stored },
				{ path: "two.dat", size: 5, content: Buffer.from("AAAAA") },
			],
		});
	});

	it("leaves a grd image stored for its own format", async () => {
		const stream = Buffer.from([0x01, 0x41, 0xee, 0xf1]);
		const payload = packed(5, stream);
		await expectArchive({
			format: iflFormat,
			archive: buildIfl([{ name: "image.grd", payload }]),
			sourcePath: "sample.ifl",
			entries: [{ path: "image.grd", size: payload.length, content: payload }],
		});
	});

	it("does not decode past the declared unpacked length", async () => {
		await expectArchive({
			format: iflFormat,
			archive: buildIfl([
				{
					name: "bounded.dat",
					payload: packed(1, Buffer.from([0xff, ...Buffer.from("ABCDEFGH")])),
				},
			]),
			sourcePath: "sample.ifl",
			entries: [{ path: "bounded.dat", size: 1, content: Buffer.from("A") }],
		});
	});

	it("rejects a blank name", async () => {
		const payload = Buffer.from("body");
		const archive = buildIfl([{ name: "one.dat", payload }]);
		archive.fill(0, INDEX_OFFSET, INDEX_OFFSET + 0x10);
		await expectArchive({
			format: iflFormat,
			archive,
			sourcePath: "sample.ifl",
			detected: false,
			entries: [],
		});
	});

	it("rejects a data offset outside the file", async () => {
		const payload = Buffer.from("body");
		const archive = buildIfl([{ name: "one.dat", payload }]);
		archive.writeUInt32LE(archive.length + 4, 4);
		await expectArchive({
			format: iflFormat,
			archive,
			sourcePath: "sample.ifl",
			detected: false,
			entries: [],
		});
	});
});
