import { encodeCp932 } from "@garbro-mcp/core";
import { pmxFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";
import { deflateSync } from "node:zlib";

const NAME_SIZE = 0x20;
const RECORD_SIZE = NAME_SIZE + 4;
const PMX_KEY = 0x21;

/** Wraps decoded container bytes the way ScenePlayer stores them. */
function buildPmxContainer(
	entries: readonly { name: string; content: Buffer }[],
): Buffer {
	const count = entries.length;
	const dataOffset = 4 + count * RECORD_SIZE;
	const decoded = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	decoded.writeInt32LE(count, 0);
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		encodeCp932(entry.name).copy(decoded, 4 + id * RECORD_SIZE);
		decoded.writeUInt32LE(
			entry.content.length,
			4 + id * RECORD_SIZE + NAME_SIZE,
		);
		entry.content.copy(decoded, position);
		position += entry.content.length;
	}
	const stored = Buffer.from(deflateSync(decoded));
	for (let index = 0; index < stored.length; index += 1)
		stored[index] = (stored[index] ?? 0) ^ PMX_KEY;
	return stored;
}

describe("ScenePlayer PMX scripts archive", () => {
	it("inflates the container and reads sequential entries", async () => {
		const first = Buffer.from("script one");
		const second = Buffer.from("script two!");
		await expectArchive({
			format: pmxFormat,
			archive: buildPmxContainer([
				{ name: "startup.pms", content: first },
				{ name: "data/scene.pms", content: second },
			]),
			sourcePath: "game.pmx",
			entries: [
				{ path: "startup.pms", size: first.length, content: first },
				{ path: "data/scene.pms", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a rooted script name", async () => {
		const container = buildPmxContainer([
			{ name: "/absolute.pms", content: Buffer.from("x") },
		]);
		await expectArchive({
			format: pmxFormat,
			archive: container,
			sourcePath: "game.pmx",
			detected: false,
			entries: [],
		});
	});

	it("requires the pmx extension", async () => {
		await expectArchive({
			format: pmxFormat,
			archive: buildPmxContainer([
				{ name: "a.pms", content: Buffer.from("x") },
			]),
			sourcePath: "game.bin",
			detected: false,
			entries: [],
		});
	});
});
