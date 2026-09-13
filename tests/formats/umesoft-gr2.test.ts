import { encodeCp932 } from "@garbro-mcp/core";
import { gr2Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x18;
const NAME_SIZE = 0x10;
const MARKER = Buffer.from("LL5\0", "latin1");

/** Compresses with the LL5 run-length scheme: literals behind a negative count, runs otherwise. */
function compressLl5(data: Buffer): Buffer {
	const chunks: number[] = [];
	let position = 0;
	while (position < data.length) {
		const value = data[position] ?? 0;
		let run = 1;
		while (
			position + run < data.length &&
			(data[position + run] ?? 0) === value &&
			run < 0x7f
		)
			run += 1;
		if (run >= 3) {
			chunks.push(run, value);
			position += run;
			continue;
		}
		// Emit literals until the next long run.
		const start = position;
		while (position < data.length) {
			const current = data[position] ?? 0;
			let length = 1;
			while (
				position + length < data.length &&
				(data[position + length] ?? 0) === current &&
				length < 0x7f
			)
				length += 1;
			if (length >= 3) break;
			position += length;
		}
		const literal = data.subarray(start, position);
		chunks.push(0x100 - literal.length, ...literal);
	}
	return Buffer.from(chunks);
}

function buildGr2(
	payloads: readonly { name: string; stored: Buffer }[],
): Buffer {
	const count = payloads.length;
	const dataOffset = INDEX_OFFSET + count * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset +
			payloads.reduce((sum, payload) => sum + payload.stored.length, 0),
	);
	archive.write("PACK", 0, "ascii");
	archive.writeInt32LE(count, 4);
	archive.writeUInt32LE(dataOffset, 8);
	let position = dataOffset;
	for (const [id, payload] of payloads.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(payload.name).copy(archive, record);
		archive.writeUInt32LE(payload.stored.length, record + NAME_SIZE);
		archive.writeUInt32LE(position, record + NAME_SIZE + 4);
		payload.stored.copy(archive, position);
		position += payload.stored.length;
	}
	return archive;
}

describe("Studio Polaris GR2 resource archive", () => {
	it("reads plain and LL5 payloads", async () => {
		const plain = Buffer.from("plain image bytes");
		const image = Buffer.from("aaaaabbbbbccccccdddddddddd");
		const stored = Buffer.concat([MARKER, compressLl5(image)]);
		await expectArchive({
			format: gr2Format,
			archive: buildGr2([
				{ name: "plain.bin", stored: plain },
				{ name: "image.grp", stored },
			]),
			sourcePath: "sample.gr2",
			entries: [
				{ path: "plain.bin", size: plain.length, content: plain },
				{ path: "image.grp", size: image.length, content: image },
			],
			metadata: { entryCount: 2, decodedEntryCount: 1 },
		});
	});

	it("rejects data offsets before the declared base", async () => {
		const archive = buildGr2([{ name: "a.bin", stored: Buffer.from("x") }]);
		archive.writeUInt32LE(0x100, 8);
		await expectArchive({
			format: gr2Format,
			archive,
			sourcePath: "sample.gr2",
			detected: false,
			entries: [],
		});
	});

	it("requires a known extension", async () => {
		await expectArchive({
			format: gr2Format,
			archive: buildGr2([{ name: "a.bin", stored: Buffer.from("x") }]),
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});
});
