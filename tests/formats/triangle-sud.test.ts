import { sudFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildSud(chunks: { content: Buffer; tagged: boolean }[]): Buffer {
	const parts = chunks.map((chunk) => {
		const header = Buffer.alloc(4);
		header.writeUInt32LE(chunk.content.length, 0);
		return Buffer.concat([header, chunk.content]);
	});
	return Buffer.concat(parts);
}

describe("Triangle SUD audio archive", () => {
	it("lists only Ogg-tagged chunks", async () => {
		const ogg1 = Buffer.concat([Buffer.from("OggS"), Buffer.from("one")]);
		const ogg2 = Buffer.concat([Buffer.from("OggS"), Buffer.from("twoo")]);
		await expectArchive({
			format: sudFormat,
			archive: buildSud([
				{ content: ogg1, tagged: true },
				{ content: Buffer.from("metadata"), tagged: false },
				{ content: ogg2, tagged: true },
			]),
			entries: [
				{ path: "00000.ogg", size: 7, content: ogg1 },
				{ path: "00001.ogg", size: 8, content: ogg2 },
			],
			metadata: { entryCount: 2 },
		});
	});
});
