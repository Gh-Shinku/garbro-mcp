import { ipqFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const HEADER_SIZE = 0x14;
const FMT_SIZE = 0x24;

interface Frame {
	content: Buffer;
}

/**
 * Builds a RIFF container: a `fmt ` chunk whose format string selects IPQ, an optional `pal ` chunk,
 * then the `anim` index with one 32-bit offset per frame.
 */
function buildIpq(
	frames: readonly Frame[],
	options: { palette: boolean } = { palette: false },
): Buffer {
	const fmtEnd = HEADER_SIZE + FMT_SIZE;
	const palSize = options.palette ? 0x40 : 0;
	const paletteEnd = fmtEnd + (options.palette ? palSize : 0);
	const animOffset = paletteEnd;
	const tableOffset = animOffset + 12;
	const dataOffset = tableOffset + frames.length * 4;
	const archive = Buffer.alloc(
		dataOffset + frames.reduce((sum, frame) => sum + frame.content.length, 0),
	);
	archive.write("RIFF", 0, "ascii");
	archive.writeInt32LE(archive.length - 8, 4);
	// The format string covers the "fmt " chunk marker at 0x0c, as in the reference.
	archive.write("IPQ fmt ", 8, "ascii");
	archive.writeInt32LE(FMT_SIZE, 0x10);
	archive.writeInt32LE(options.palette ? 1 : 0, HEADER_SIZE + 4);
	archive.write("anim", animOffset, "ascii");
	archive.writeUInt32LE(tableOffset - animOffset, animOffset + 4);
	archive.writeInt32LE(frames.length, animOffset + 8);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, frame] of frames.entries()) {
		archive.writeUInt32LE(offset, tableOffset + id * 4);
		frame.content.copy(archive, position);
		offset += frame.content.length;
		position += frame.content.length;
	}
	if (options.palette) {
		archive.write("pal ", fmtEnd, "ascii");
		archive.writeInt32LE(palSize, fmtEnd + 4);
	}
	return archive;
}

describe("TechnoBrain IPQ animation resource", () => {
	it("reads the anim index behind the IPF header", async () => {
		const first = Buffer.from("frame one");
		const second = Buffer.from("frame two!");
		await expectArchive({
			format: ipqFormat,
			archive: buildIpq([{ content: first }, { content: second }]),
			sourcePath: "sample.ipq",
			entries: [
				{ path: "sample#000", size: first.length, content: first },
				{ path: "sample#001", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("skips an optional palette chunk", async () => {
		const content = Buffer.from("framed payload");
		await expectArchive({
			format: ipqFormat,
			archive: buildIpq([{ content }], { palette: true }),
			sourcePath: "sample.ipq",
			entries: [{ path: "sample#000", size: content.length, content }],
		});
	});

	it("rejects a missing fmt chunk", async () => {
		const archive = buildIpq([{ content: Buffer.from("x") }]);
		archive.write("IPX fmt ", 8, "ascii");
		await expectArchive({
			format: ipqFormat,
			archive,
			sourcePath: "sample.ipq",
			detected: false,
			entries: [],
		});
	});

	it("rejects a non-IPQ format string", async () => {
		const archive = buildIpq([{ content: Buffer.from("x") }]);
		archive.write("IPF fmt ", 8, "ascii");
		await expectArchive({
			format: ipqFormat,
			archive,
			sourcePath: "sample.ipq",
			detected: false,
			entries: [],
		});
	});
});
