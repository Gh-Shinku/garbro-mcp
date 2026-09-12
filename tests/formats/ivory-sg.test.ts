import { BufferByteSource } from "@garbro-mcp/core";
import { ivorySgFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, expect, it } from "vitest";

function u32(value: number): Buffer {
	const buffer = Buffer.alloc(4);
	buffer.writeUInt32LE(value, 0);
	return buffer;
}

function buildSg(frames: Buffer[]): { archive: Buffer; objects: Buffer[] } {
	const objects = frames.map((frame) =>
		Buffer.concat([
			Buffer.from("fSG ", "ascii"),
			u32(0x0c + frame.length),
			Buffer.alloc(4, 0x22),
			frame,
		]),
	);
	const chunks = objects.map((object) =>
		Buffer.concat([
			Buffer.from("cOBJ", "ascii"),
			u32(0x10 + object.length),
			Buffer.alloc(8, 0x11),
			object,
		]),
	);
	return {
		archive: Buffer.concat([
			Buffer.from("fSGX", "ascii"),
			Buffer.alloc(4),
			...chunks,
		]),
		objects,
	};
}

describe("Ivory SG multi-frame image", () => {
	it("lists every cOBJ chunk carrying an fSG object", async () => {
		const fixture = buildSg([Buffer.from("frame1"), Buffer.from("frame2")]);
		await expectArchive({
			format: ivorySgFormat,
			archive: fixture.archive,
			sourcePath: "cg.sg",
			entries: [
				{ path: "cg#0", size: 0x12, content: fixture.objects[0] },
				{ path: "cg#1", size: 0x12, content: fixture.objects[1] },
			],
			metadata: { frameCount: 2 },
		});
	});

	it("rejects a chunk with an invalid size", async () => {
		const fixture = buildSg([Buffer.from("frame1")]);
		fixture.archive.writeUInt32LE(4, 8 + 4);
		expect(
			await ivorySgFormat.detect(new BufferByteSource(fixture.archive)),
		).toBe(false);
	});
});
