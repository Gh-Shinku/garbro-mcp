import { rotateByteLeft, spPakFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const KANNAGI = 0x69695669;
const FROM_M = 0x8492e36f;
const ROTATION = 2;

/**
 * The inverse of the archive's transform: the port unkeys a stored byte and then rotates it right, so a fixture
 * rotates the plaintext left first and keys the result.
 */
function stored(plain: Buffer, key: number): Buffer {
	const output = Buffer.from(plain);
	for (let index = 0; index < output.length; index += 1)
		output[index] = rotateByteLeft(output[index] ?? 0, ROTATION) ^ key;
	return output;
}

/** The head holds the signature and a count, the offsets follow, and the payloads sit behind them. */
function buildSp(
	signature: number,
	key: number,
	payloads: readonly Buffer[],
): Buffer {
	const tableSize = payloads.length * 4;
	const dataOffset = 8 + tableSize;
	const archive = Buffer.alloc(
		dataOffset + payloads.reduce((sum, item) => sum + item.length, 0),
	);
	archive.writeUInt32LE(signature, 0);
	archive.writeInt32LE(payloads.length, 4);
	let position = dataOffset;
	for (const [id, item] of payloads.entries()) {
		archive.writeUInt32LE(position - dataOffset, 8 + id * 4);
		item.copy(archive, position);
		position += item.length;
	}
	return archive;
}

describe("BlackRainbow script archive", () => {
	it("reads two entries under the Kannagi key", async () => {
		const first = Buffer.from("first script");
		const second = Buffer.from("second script");
		await expectArchive({
			format: spPakFormat,
			archive: buildSp(KANNAGI, 0x07, [
				stored(first, 0x07),
				stored(second, 0x07),
			]),
			sourcePath: "sample.pak",
			entries: [
				{ path: "sample#0000", size: first.length, content: first },
				{ path: "sample#0001", size: second.length, content: second },
			],
		});
	});

	it("uses the second signature's own key", async () => {
		const content = Buffer.from("from m script");
		await expectArchive({
			format: spPakFormat,
			archive: buildSp(FROM_M, 0x9c, [stored(content, 0x9c)]),
			sourcePath: "sample.pak",
			entries: [{ path: "sample#0000", size: content.length, content }],
		});
	});

	it("rejects an unknown signature", async () => {
		const content = Buffer.from("body");
		const archive = buildSp(KANNAGI, 0x07, [stored(content, 0x07)]);
		archive.writeUInt32LE(0x12345678, 0);
		await expectArchive({
			format: spPakFormat,
			archive,
			sourcePath: "sample.pak",
			detected: false,
			entries: [],
		});
	});

	it("rejects an empty entry count", async () => {
		const content = Buffer.from("body");
		const archive = buildSp(KANNAGI, 0x07, [stored(content, 0x07)]);
		archive.writeInt32LE(0, 4);
		await expectArchive({
			format: spPakFormat,
			archive,
			sourcePath: "sample.pak",
			detected: false,
			entries: [],
		});
	});

	it("rejects an offset that leaves the file", async () => {
		const content = Buffer.from("body");
		const archive = buildSp(KANNAGI, 0x07, [stored(content, 0x07)]);
		archive.writeUInt32LE(0x1000, 8);
		await expectArchive({
			format: spPakFormat,
			archive,
			sourcePath: "sample.pak",
			detected: false,
			entries: [],
		});
	});
});
