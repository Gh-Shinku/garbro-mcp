import { weaponVoiceFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildWeaponVoice(contents: Buffer[]): Buffer {
	const indexSize = contents.length * 4 + 8;
	const total = indexSize + contents.reduce((sum, c) => sum + c.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeInt32LE(contents.length, 0);
	let offset = indexSize;
	for (const [id, content] of contents.entries()) {
		archive.writeUInt32LE(offset, 4 + id * 4);
		content.copy(archive, offset);
		offset += content.length;
	}
	archive.writeUInt32LE(offset, indexSize - 4);
	return archive;
}

describe("Weapon DAT voice archive", () => {
	it("validates the trailing size sentinel and derives sizes", async () => {
		await expectArchive({
			format: weaponVoiceFormat,
			archive: buildWeaponVoice([Buffer.from("aa"), Buffer.from("bbb")]),
			sourcePath: "voice.dat",
			entries: [
				{ path: "voice#0000.wav", size: 2, content: Buffer.from("aa") },
				{ path: "voice#0001.wav", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
