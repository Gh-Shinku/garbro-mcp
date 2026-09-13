import { chrFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildChr(records: { size: number }[], first: Buffer): Buffer {
	const baseOffset = 0x1b1;
	// Record slots live in [12, baseOffset); frame payloads follow the first frame.
	const dataOffset = baseOffset + first.length;
	const total =
		dataOffset + records.reduce((sum, record) => sum + record.size, 0);
	const archive = Buffer.alloc(total);
	archive.writeUInt32LE(0x1b1, 0);
	archive.writeUInt32LE(first.length, 4);
	first.copy(archive, baseOffset);
	let offset = dataOffset;
	for (const [id, record] of records.entries()) {
		const position = 12 + id * 0x24;
		archive.writeUInt32LE(offset, position);
		archive.writeUInt32LE(record.size, position + 4);
		offset += record.size;
	}
	return archive;
}

describe("Tigerman CHR compound image", () => {
	it("reads the first frame at the ZT offset plus indexed frames", async () => {
		const first = Buffer.from("ZTbase");
		const archive = buildChr([{ size: 2 }], first);
		archive.write("aa", 0x1b1 + first.length);
		await expectArchive({
			format: chrFormat,
			archive,
			sourcePath: "cg.chr",
			entries: [
				{ path: "cg#0.ZIT", size: first.length, content: first },
				{ path: "cg#1.ZIT", size: 2, content: Buffer.from("aa") },
			],
			metadata: { frameCount: 2 },
		});
	});
});
