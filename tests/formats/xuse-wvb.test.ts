import { wvbFormat } from "@garbro-mcp/formats";
import { expectArchive, type ExpectedEntry } from "../helpers/archive.js";
import { describe, it } from "vitest";

const WAV_HEADER_SIZE = 16;
const FMT_SIZE = 0x10;

/** Builds the 16-byte RIFF header GARbro writes for WVB payloads. */
function wavHeader(finalSize: number): Buffer {
	const header = Buffer.alloc(WAV_HEADER_SIZE);
	header.writeUInt32LE(0x46464952, 0);
	header.writeUInt32LE(finalSize - 8, 4);
	header.writeUInt32LE(0x45564157, 8);
	header.writeUInt32LE(0x20746d66, 12);
	return header;
}

/**
 * The offset field of the first record doubles as the data-start indicator, so the first payload
 * begins at the end of the index and therefore covers the fmt chunk and the data marker.
 */
function buildWvb(payloads: readonly Buffer[]): {
	archive: Buffer;
	entries: ExpectedEntry[];
} {
	const count = payloads.length;
	const dataStart = count * 8;
	const prefixSize = 4 + FMT_SIZE + 4 + 4;
	const archive = Buffer.alloc(
		dataStart +
			prefixSize +
			payloads.reduce((sum, payload) => sum + payload.length, 0),
	);
	archive.writeUInt32LE(FMT_SIZE, dataStart);
	archive.write("data", dataStart + 4 + FMT_SIZE, "ascii");
	let position = dataStart + prefixSize;
	const starts: number[] = [];
	for (const payload of payloads) {
		starts.push(position);
		payload.copy(archive, position);
		position += payload.length;
	}
	const entries: ExpectedEntry[] = [];
	for (const [id, payload] of payloads.entries()) {
		// The first entry starts at the data area and swallows the generated prefix.
		const entryStart = id === 0 ? dataStart : (starts[id] ?? 0);
		const entryEnd = starts[id + 1] ?? position;
		const stored = entryEnd - entryStart;
		archive.writeUInt32LE(stored + 8, id * 8);
		archive.writeUInt32LE(entryStart + 1, id * 8 + 4);
		entries.push({
			path: `sound#${String(id).padStart(2, "0")}`,
			size: stored + WAV_HEADER_SIZE,
			content: Buffer.concat([
				wavHeader(stored + WAV_HEADER_SIZE),
				archive.subarray(entryStart, entryEnd),
			]),
		});
		void payload;
	}
	return { archive, entries };
}

describe("Xuse WVB audio archive", () => {
	it("reads records and generates RIFF headers", async () => {
		const built = buildWvb([Buffer.from("pcm one"), Buffer.from("pcm two!")]);
		await expectArchive({
			format: wvbFormat,
			archive: built.archive,
			sourcePath: "sound.wvb",
			entries: built.entries,
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a missing data marker", async () => {
		const built = buildWvb([Buffer.from("x")]);
		built.archive.write("datx", 8 * 1 + 4 + FMT_SIZE, "ascii");
		await expectArchive({
			format: wvbFormat,
			archive: built.archive,
			sourcePath: "sound.wvb",
			detected: false,
			entries: [],
		});
	});

	it("rejects a misaligned first offset", async () => {
		const built = buildWvb([Buffer.from("x")]);
		built.archive.writeInt32LE(0x12, 4);
		await expectArchive({
			format: wvbFormat,
			archive: built.archive,
			sourcePath: "sound.wvb",
			detected: false,
			entries: [],
		});
	});
});
