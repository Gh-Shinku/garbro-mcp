import { encodeCp932, FileByteSource } from "@garbro-mcp/core";
import { gpcFormat, sndFormat, snrFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, expect, it } from "vitest";

interface IndexEntry {
	name: string;
	offset: number;
}

/** Index records are a one-byte name length, bitwise-inverted name bytes and a 32-bit offset. */
function buildIndex(entries: readonly IndexEntry[]): Buffer {
	const parts: Buffer[] = [];
	for (const entry of entries) {
		const name = Buffer.from(encodeCp932(entry.name));
		for (let index = 0; index < name.length; index += 1)
			name[index] = ~(name[index] ?? 0) & 0xff;
		const offset = Buffer.alloc(4);
		offset.writeUInt32LE(entry.offset, 0);
		parts.push(Buffer.from([name.length]), name, offset);
	}
	return Buffer.concat(parts);
}

describe("Eushully companion-index archives", () => {
	it("reads a graphic archive through its companion index", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		const main = Buffer.concat([first, second]);
		const index = buildIndex([
			{ name: "one", offset: 0 },
			{ name: "two", offset: first.length },
		]);
		await withCompanionFiles(
			"sample.gpc",
			{ "sample.gpc": main, "sample.gph": index },
			async (mainPath) => {
				await expectCompanionArchive({
					format: gpcFormat,
					mainPath,
					entries: [
						{ path: "one.gpcf", size: first.length, content: first },
						{ path: "two.gpcf", size: second.length, content: second },
					],
				});
			},
		);
	});

	it("sorts offsets before deriving sizes", async () => {
		const first = Buffer.from("alpha body");
		const second = Buffer.from("beta body!");
		const main = Buffer.concat([first, second]);
		// The index lists the later payload first, so only sorting makes the sizes right.
		const index = buildIndex([
			{ name: "later", offset: first.length },
			{ name: "earlier", offset: 0 },
		]);
		await withCompanionFiles(
			"sample.gpc",
			{ "sample.gpc": main, "sample.gph": index },
			async (mainPath) => {
				await expectCompanionArchive({
					format: gpcFormat,
					mainPath,
					entries: [
						{ path: "earlier.gpcf", size: first.length, content: first },
						{ path: "later.gpcf", size: second.length, content: second },
					],
				});
			},
		);
	});

	it("reads a script archive without an appended extension", async () => {
		const content = Buffer.from("script body");
		const index = buildIndex([{ name: "one.ks", offset: 0 }]);
		// The companion name keeps the first two extension letters and appends `h`, so both the audio and the
		// script archives in this family are indexed by the same `snh` name.
		await withCompanionFiles(
			"sample.snr",
			{ "sample.snr": content, "sample.snh": index },
			async (mainPath) => {
				await expectCompanionArchive({
					format: snrFormat,
					mainPath,
					entries: [{ path: "one.ks", size: content.length, content }],
				});
			},
		);
	});

	it("synthesizes a wave header for the audio archive", async () => {
		const dataSize = 4;
		const payload = Buffer.alloc(0x15 + dataSize, 0x21);
		payload.writeUInt32LE(dataSize, 0x11);
		const index = buildIndex([{ name: "voice", offset: 0 }]);
		const expectedHeader = Buffer.alloc(0x2c);
		expectedHeader.write("RIFF", 0, "ascii");
		expectedHeader.writeUInt32LE(dataSize + 0x24, 4);
		expectedHeader.write("WAVE", 8, "ascii");
		expectedHeader.write("fmt ", 0x0c, "ascii");
		expectedHeader.writeUInt32LE(0x10, 0x10);
		payload.copy(expectedHeader, 0x14, 1, 0x11);
		expectedHeader.write("data", 0x24, "ascii");
		expectedHeader.writeUInt32LE(dataSize, 0x28);
		const expected = Buffer.concat([
			expectedHeader,
			payload.subarray(0x15, 0x15 + dataSize),
		]);
		await withCompanionFiles(
			"sample.snd",
			{ "sample.snd": payload, "sample.snh": index },
			async (mainPath) => {
				await expectCompanionArchive({
					format: sndFormat,
					mainPath,
					entries: [
						{ path: "voice.wav", size: payload.length, content: expected },
					],
				});
			},
		);
	});

	it("rejects an archive without a companion index", async () => {
		const content = Buffer.from("body");
		await expectArchive({
			format: gpcFormat,
			archive: content,
			sourcePath: "sample.gpc",
			detected: false,
			entries: [],
		});
	});

	it("rejects an index file as an archive", async () => {
		const content = Buffer.from("body");
		const index = buildIndex([{ name: "one", offset: 0 }]);
		await withCompanionFiles(
			"sample.gph",
			{ "sample.gph": content, "sample.gpp": index },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await gpcFormat.detect(source, mainPath)).toBe(false);
				await source.close();
			},
		);
	});
});
