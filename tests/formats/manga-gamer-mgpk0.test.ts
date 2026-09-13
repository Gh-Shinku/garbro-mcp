import { mgpk0Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x0c;
const RECORD_SIZE = 0x30;

interface Entry {
	name: string;
	content: Buffer;
}

/** Records carry a UTF-8 name, a data offset and a stored size at the end of the 0x30-byte record. */
function buildMgpk0(entries: readonly Entry[]): Buffer {
	const dataOffset = INDEX_OFFSET + RECORD_SIZE * entries.length;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("MGPK", 0, "ascii");
	archive.writeInt32LE(0, 4);
	archive.writeInt32LE(entries.length, 8);
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		archive.write(entry.name, record, "utf8");
		archive.writeUInt32LE(position, record + 0x20);
		archive.writeUInt32LE(entry.content.length, record + 0x2c);
		entry.content.copy(archive, position);
		position += entry.content.length;
	}
	return archive;
}

describe("MG resource archive version 0", () => {
	it("reads entries and extracts them as stored", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: mgpk0Format,
			archive: buildMgpk0([
				{ name: "one.dat", content: first },
				{ name: "two.dat", content: second },
			]),
			sourcePath: "sample.pac",
			entries: [
				{ path: "one.dat", size: first.length, content: first },
				{ path: "two.dat", size: second.length, content: second },
			],
		});
	});

	it("keeps flagged payloads stored while marking them", async () => {
		// A png name marks the archive as needing a user key, which cannot be derived from the file, so the
		// reference returns the payload verbatim when no key is configured and the port does the same.
		const content = Buffer.from("stored png body");
		await expectArchive({
			format: mgpk0Format,
			archive: buildMgpk0([{ name: "image.png", content }]),
			sourcePath: "sample.pac",
			entries: [{ path: "image.png", size: content.length, content }],
		});
	});

	it("rejects a later version", async () => {
		const content = Buffer.from("body");
		const archive = buildMgpk0([{ name: "one.dat", content }]);
		archive.writeInt32LE(1, 4);
		await expectArchive({
			format: mgpk0Format,
			archive,
			sourcePath: "sample.pac",
			detected: false,
			entries: [],
		});
	});

	it("rejects a foreign signature", async () => {
		const content = Buffer.from("body");
		const archive = buildMgpk0([{ name: "one.dat", content }]);
		archive.write("MGPJ", 0, "ascii");
		await expectArchive({
			format: mgpk0Format,
			archive,
			sourcePath: "sample.pac",
			detected: false,
			entries: [],
		});
	});

	it("requires the pac extension", async () => {
		const content = Buffer.from("body");
		await expectArchive({
			format: mgpk0Format,
			archive: buildMgpk0([{ name: "one.dat", content }]),
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});
});
