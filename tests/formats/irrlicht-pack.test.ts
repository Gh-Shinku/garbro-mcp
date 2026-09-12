import { encodeCp932 } from "@garbro-mcp/core";
import { irrlichtPackFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildPack(entries: { name: string; content: Buffer }[]): Buffer {
	const records = entries.map((entry) => {
		const header = Buffer.alloc(0x10a, 0x5f);
		const name = encodeCp932(entry.name);
		name.copy(header, 0);
		header[name.length] = 0;
		header.writeUInt32LE(entry.content.length, 0x105);
		header[0x109] = 0;
		return Buffer.concat([header, entry.content]);
	});
	return Buffer.concat(records);
}

describe("Irrlicht PACK archive", () => {
	it("walks 0x10a-byte record headers", async () => {
		await expectArchive({
			format: irrlichtPackFormat,
			archive: buildPack([
				{ name: "sound1.wav", content: Buffer.from("aaaa") },
				{ name: "dir\\sound2.wav", content: Buffer.from("bb") },
			]),
			sourcePath: "data.pack",
			entries: [
				{ path: "sound1.wav", size: 4, content: Buffer.from("aaaa") },
				{ path: "dir/sound2.wav", size: 2, content: Buffer.from("bb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
