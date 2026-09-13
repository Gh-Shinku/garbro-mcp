import { encodeCp932 } from "@garbro-mcp/core";
import { neonAr2Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const KEY = 0x55;

function buildNeon(
	entries: readonly { name: string; content: Buffer }[],
): Buffer {
	const records = entries.map((entry, id) => {
		const name = encodeCp932(entry.name);
		const header = Buffer.alloc(0x10);
		header.writeUInt32LE(entry.content.length, 0);
		// GARbro requires the first record to repeat its size at +4 and to keep +8 clear.
		if (id === 0) header.writeUInt32LE(entry.content.length, 4);
		header.writeInt32LE(name.length, 0x0c);
		return Buffer.concat([header, name, entry.content]);
	});
	const archive = Buffer.concat(records);
	for (let position = 0; position < archive.length; position += 1)
		archive[position] = (archive[position] ?? 0) ^ KEY;
	return archive;
}

describe("Neon AR2 archive", () => {
	it("decrypts the archive and walks its records", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second!");
		await expectArchive({
			format: neonAr2Format,
			archive: buildNeon([
				{ name: "data/one.bin", content: first },
				{ name: "two.bin", content: second },
			]),
			sourcePath: "sample.ar2",
			entries: [
				{ path: "data/one.bin", size: first.length, content: first },
				{ path: "two.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a broken key word", async () => {
		const archive = buildNeon([{ name: "a.bin", content: Buffer.from("a") }]);
		archive.writeUInt32LE(0x12345678, 8);
		await expectArchive({
			format: neonAr2Format,
			archive,
			sourcePath: "sample.ar2",
			detected: false,
			entries: [],
		});
	});

	it("rejects a name length beyond the limit", async () => {
		const archive = buildNeon([{ name: "a.bin", content: Buffer.from("a") }]);
		// Plaintext name length 0x200 is above GARbro's 0x100 limit.
		archive.writeInt32LE(0x200 ^ 0x55555555, 0x0c);
		await expectArchive({
			format: neonAr2Format,
			archive,
			sourcePath: "sample.ar2",
			detected: false,
			entries: [],
		});
	});
});
