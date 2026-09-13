import { voiceFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const COUNT_SIZE = 2;

/** Builds the offset-chain variant: a count and one 32-bit offset per entry. */
function buildV1(payloads: readonly Buffer[]): Buffer {
	const count = payloads.length;
	const dataOffset = COUNT_SIZE + count * 4;
	const archive = Buffer.concat([Buffer.alloc(dataOffset), ...payloads]);
	archive.writeInt16LE(count, 0);
	let offset = dataOffset;
	for (const [id, payload] of payloads.entries()) {
		archive.writeUInt32LE(offset, COUNT_SIZE + id * 4);
		offset += payload.length;
	}
	return archive;
}

/** Builds the record variant: a count, a spare word, and offset/size records from 6. */
function buildV2(payloads: readonly Buffer[]): Buffer {
	const count = payloads.length;
	const indexSize = count * 12;
	const dataOffset = 6 + indexSize;
	const archive = Buffer.concat([Buffer.alloc(dataOffset), ...payloads]);
	archive.writeInt16LE(count, 0);
	let offset = dataOffset;
	for (const [id, payload] of payloads.entries()) {
		const record = 6 + id * 12;
		archive.writeUInt32LE(offset, record);
		archive.writeUInt32LE(payload.length, record + 4);
		offset += payload.length;
	}
	return archive;
}

describe("Seraphim voice archive", () => {
	it("reads the offset-chain variant", async () => {
		const first = Buffer.from("RIFF wav one");
		const second = Buffer.from("RIFF wav two");
		await expectArchive({
			format: voiceFormat,
			archive: buildV1([first, second]),
			sourcePath: "Voice1.dat",
			entries: [
				{ path: "00000.wav", size: first.length, content: first },
				{ path: "00001.wav", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("reads the record variant", async () => {
		const first = Buffer.from("OggS one");
		const second = Buffer.from("OggS two!");
		await expectArchive({
			format: voiceFormat,
			archive: buildV2([first, second]),
			sourcePath: "Voicepac.dat",
			entries: [
				{ path: "00000.ogg", size: first.length, content: first },
				{ path: "00001.ogg", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("requires the single-digit voice file name pattern", async () => {
		await expectArchive({
			format: voiceFormat,
			archive: buildV1([Buffer.from("x")]),
			sourcePath: "Voice12.dat",
			detected: false,
			entries: [],
		});
	});

	it("rejects a non-increasing offset chain", async () => {
		const archive = buildV1([Buffer.from("aa"), Buffer.from("bb")]);
		// Point the second offset at the first payload.
		archive.writeUInt32LE(COUNT_SIZE + 8, COUNT_SIZE + 4);
		await expectArchive({
			format: voiceFormat,
			archive,
			sourcePath: "Voice1.dat",
			detected: false,
			entries: [],
		});
	});
});
