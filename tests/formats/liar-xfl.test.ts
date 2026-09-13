import { xflFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const HEADER_SIZE = 12;
const RECORD_SIZE = 40;

const SIGNATURE = Buffer.from([0x4c, 0x42, 0x01, 0x00]);

interface Entry {
	name: string;
	content: Buffer;
	/** When set, the payload is treated as a nested archive whose bytes are used verbatim. */
	nestedArchive?: Buffer;
}

/** Builds a directory: the header, its records and then the payloads, with `dirSize` covering the records. */
function buildXfl(
	entries: readonly Entry[],
	dirSize = entries.length * RECORD_SIZE,
): Buffer {
	const dataOffset = HEADER_SIZE + dirSize;
	const payloads = entries.map((entry) => entry.nestedArchive ?? entry.content);
	const total = payloads.reduce((sum, payload) => sum + payload.length, 0);
	const archive = Buffer.alloc(dataOffset + total);
	SIGNATURE.copy(archive, 0);
	archive.writeUInt32LE(dirSize, 4);
	archive.writeInt32LE(entries.length, 8);
	let data = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = HEADER_SIZE + id * RECORD_SIZE;
		archive.write(entry.name, record, "latin1");
		archive.writeUInt32LE(data - dataOffset, record + 32);
		archive.writeUInt32LE(payloads[id]?.length ?? 0, record + 36);
		payloads[id]?.copy(archive, data);
		data += payloads[id]?.length ?? 0;
	}
	return archive;
}

describe("Liar XFL resource archive", () => {
	it("recurses into a nested archive whose name ends in xfl", async () => {
		const inner = Buffer.from("inner body");
		const flat = Buffer.from("flat body");
		const nested = buildXfl([{ name: "inner.dat", content: inner }]);
		const archive = buildXfl([
			{ name: "sub.xfl", content: Buffer.alloc(0), nestedArchive: nested },
			{ name: "flat.dat", content: flat },
		]);
		await expectArchive({
			format: xflFormat,
			archive,
			sourcePath: "sample.xfl",
			entries: [
				{ path: "sub.xfl/inner.dat", size: inner.length, content: inner },
				{ path: "flat.dat", size: flat.length, content: flat },
			],
		});
	});

	it("treats a nested-looking name as an entry when its payload is not an archive", async () => {
		const content = Buffer.from("not an archive");
		await expectArchive({
			format: xflFormat,
			archive: buildXfl([{ name: "sub.xfl", content }]),
			sourcePath: "sample.xfl",
			entries: [{ path: "sub.xfl", size: content.length, content }],
		});
	});

	it("rejects a directory whose records exceed its region", async () => {
		const content = Buffer.from("body");
		const archive = buildXfl([{ name: "one.dat", content }], RECORD_SIZE - 4);
		await expectArchive({
			format: xflFormat,
			archive,
			sourcePath: "sample.xfl",
			detected: false,
			entries: [],
		});
	});

	it("rejects a foreign signature", async () => {
		const content = Buffer.from("body");
		const archive = buildXfl([{ name: "one.dat", content }]);
		archive.write("XX", 0, "latin1");
		await expectArchive({
			format: xflFormat,
			archive,
			sourcePath: "sample.xfl",
			detected: false,
			entries: [],
		});
	});

	it("rejects an entry that reaches past its region", async () => {
		const content = Buffer.from("body");
		const archive = buildXfl([{ name: "one.dat", content }]);
		archive.writeUInt32LE(0x100, HEADER_SIZE + 36);
		await expectArchive({
			format: xflFormat,
			archive,
			sourcePath: "sample.xfl",
			detected: false,
			entries: [],
		});
	});
});
