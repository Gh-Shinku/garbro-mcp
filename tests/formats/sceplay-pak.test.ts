import { encodeCp932 } from "@garbro-mcp/core";
import { sceplayPakFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildSceplay(
	entries: { name: string; content: Buffer; absent?: boolean }[],
): Buffer {
	const names = Buffer.concat(
		entries.map((entry) =>
			Buffer.concat([encodeCp932(entry.name), Buffer.from([0])]),
		),
	);
	const tableSize = entries.length * 8;
	const dataOffset = 8 + names.length + tableSize;
	const total =
		dataOffset +
		entries.reduce(
			(sum, entry) => (entry.absent ? sum : sum + entry.content.length),
			0,
		);
	const archive = Buffer.alloc(total);
	archive.write("pak\0", 0, "binary");
	archive.writeInt32LE(entries.length, 4);
	names.copy(archive, 8);
	const sizesAt = 8 + names.length;
	const offsetsAt = sizesAt + entries.length * 4;
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		if (entry.absent) {
			archive.writeUInt32LE(0, sizesAt + id * 4);
			archive.writeUInt32LE(0xffffffff, offsetsAt + id * 4);
			continue;
		}
		archive.writeUInt32LE(entry.content.length, sizesAt + id * 4);
		archive.writeUInt32LE(offset, offsetsAt + id * 4);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Sceplay PAK archive", () => {
	it("reads names, sizes, and offsets in separate sections", async () => {
		await expectArchive({
			format: sceplayPakFormat,
			archive: buildSceplay([
				{ name: "first.dat", content: Buffer.from("aa") },
				{ name: "absent.dat", content: Buffer.alloc(0), absent: true },
				{ name: "third.dat", content: Buffer.from("bbb") },
			]),
			entries: [
				{ path: "first.dat", size: 2, content: Buffer.from("aa") },
				{ path: "third.dat", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
