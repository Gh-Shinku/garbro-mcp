import { s25Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 8;

interface S25Entry {
	content: Buffer;
	/** Overrides the recorded offset, for example to skip an entry. */
	offset?: number;
}

function buildS25(entries: readonly S25Entry[]): Buffer {
	const count = entries.length;
	const dataOffset = INDEX_OFFSET + count * 4;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("S25\0", 0, "latin1");
	archive.writeInt32LE(count, 4);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		archive.writeUInt32LE(entry.offset ?? offset, INDEX_OFFSET + id * 4);
		entry.content.copy(archive, position);
		offset += entry.content.length;
		position += entry.content.length;
	}
	return archive;
}

describe("ShiinaRio S25 multi-image", () => {
	it("sorts offsets and derives sizes", async () => {
		const first = Buffer.from("frame one");
		const second = Buffer.from("frame two!");
		await expectArchive({
			format: s25Format,
			archive: buildS25([{ content: first }, { content: second }]),
			sourcePath: "graphic.s25",
			entries: [
				{ path: "graphic@0000", size: first.length, content: first },
				{ path: "graphic@0001", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("skips offsets outside the file and keeps the original index in names", async () => {
		const first = Buffer.from("only frame");
		const ignored = Buffer.from("ignored");
		const archive = buildS25([
			{ content: first },
			{ content: ignored, offset: 0 },
		]);
		// The surviving entry still runs to the end of the file, so it covers the skipped payload.
		await expectArchive({
			format: s25Format,
			archive,
			sourcePath: "graphic.s25",
			entries: [
				{
					path: "graphic@0000",
					size: first.length + ignored.length,
					content: Buffer.concat([first, ignored]),
				},
			],
			metadata: { entryCount: 1 },
		});
	});

	it("rejects a missing signature", async () => {
		const archive = buildS25([{ content: Buffer.from("x") }]);
		archive.write("S24\0", 0, "latin1");
		await expectArchive({
			format: s25Format,
			archive,
			sourcePath: "graphic.s25",
			detected: false,
			entries: [],
		});
	});
});
