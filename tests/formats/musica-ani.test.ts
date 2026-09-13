import { encodeCp932 } from "@garbro-mcp/core";
import { aniFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 8;
const FRAME_HEADER_SIZE = 10;

interface Frame {
	name: string;
	width: number;
	height: number;
	bpp: number;
}

/**
 * Builds one animation record: the index side holds the NUL-terminated frame name, while the entry
 * itself is the ten-byte header plus the pixel data implied by the dimensions.
 */
function frame(definition: Frame): { record: Buffer; entry: Buffer } {
	const name = Buffer.concat([encodeCp932(definition.name), Buffer.from([0])]);
	const pixels = (definition.width * definition.height * definition.bpp) / 8;
	const entry = Buffer.alloc(FRAME_HEADER_SIZE + pixels);
	entry.writeUInt16LE(definition.width, 0);
	entry.writeUInt16LE(definition.height, 2);
	entry.writeUInt16LE(definition.bpp, 6);
	entry.fill(0x5a, FRAME_HEADER_SIZE);
	return { record: Buffer.concat([name, entry]), entry };
}

function buildAni(records: readonly Buffer[]): Buffer {
	const archive = Buffer.concat([Buffer.alloc(INDEX_OFFSET), ...records]);
	archive.writeUInt16LE(0x100, 0);
	archive.writeInt16LE(records.length, 2);
	return archive;
}

describe("Musica engine ANI animation resource", () => {
	it("sizes frames from their headers", async () => {
		const first = frame({ name: "one", width: 4, height: 2, bpp: 8 });
		const second = frame({ name: "two", width: 2, height: 2, bpp: 32 });
		await expectArchive({
			format: aniFormat,
			archive: buildAni([first.record, second.record]),
			sourcePath: "anim.ani",
			entries: [
				{ path: "anim#one", size: first.entry.length, content: first.entry },
				{ path: "anim#two", size: second.entry.length, content: second.entry },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a wrong version word", async () => {
		const archive = buildAni([
			frame({ name: "one", width: 2, height: 2, bpp: 8 }).record,
		]);
		archive.writeUInt16LE(0x101, 0);
		await expectArchive({
			format: aniFormat,
			archive,
			sourcePath: "anim.ani",
			detected: false,
			entries: [],
		});
	});

	it("rejects a non-zero reserved word", async () => {
		const archive = buildAni([
			frame({ name: "one", width: 2, height: 2, bpp: 8 }).record,
		]);
		archive.writeUInt32LE(1, 4);
		await expectArchive({
			format: aniFormat,
			archive,
			sourcePath: "anim.ani",
			detected: false,
			entries: [],
		});
	});

	it("rejects a frame that exceeds the file", async () => {
		const archive = buildAni([
			frame({ name: "one", width: 2, height: 2, bpp: 8 }).record,
		]);
		// Claim a much larger frame than the file holds.
		archive.writeUInt16LE(0x1000, INDEX_OFFSET + 4);
		await expectArchive({
			format: aniFormat,
			archive,
			sourcePath: "anim.ani",
			detected: false,
			entries: [],
		});
	});
});
