import { plantechPacFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, expect, it } from "vitest";
import { BufferByteSource } from "@garbro-mcp/core";

function buildPlantech(bmp: Buffer): Buffer {
	const archive = Buffer.alloc(8 + bmp.length);
	archive.writeUInt32LE(0, 0);
	archive.writeUInt32LE(bmp.readUInt32LE(2), 4);
	bmp.copy(archive, 8);
	return archive;
}

describe("PLANTECH PAC bitmap package", () => {
	it("exposes the embedded BMP as a single entry", async () => {
		const bmp = Buffer.concat([
			Buffer.from("BM", "ascii"),
			Buffer.alloc(10),
			Buffer.from("pixels"),
		]);
		await expectArchive({
			format: plantechPacFormat,
			archive: buildPlantech(bmp),
			sourcePath: "cg01.pac",
			entries: [{ path: "cg01.BMP", size: bmp.length, content: bmp }],
			metadata: { entryCount: 1 },
		});
	});

	it("requires the mirrored size fields to match", async () => {
		const bmp = Buffer.concat([Buffer.from("BM", "ascii"), Buffer.alloc(10)]);
		const archive = buildPlantech(bmp);
		archive.writeUInt32LE(0x100, 10);
		expect(await plantechPacFormat.detect(new BufferByteSource(archive))).toBe(
			false,
		);
	});
});
