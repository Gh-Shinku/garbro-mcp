import { ipacFormat } from "@garbro-mcp/formats";
import { encodeCp932 } from "@garbro-mcp/core";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";
import { describe, it } from "vitest";

function buildIpac(
	entries: { name: string; content: Buffer; packed?: boolean }[],
): Buffer {
	const indexOffset = 8;
	const indexSize = entries.length * 0x2c;
	const dataOffset = indexOffset + indexSize;
	const payloads = entries.map((entry) =>
		entry.packed
			? Buffer.concat([
					Buffer.from("IEL1", "ascii"),
					(() => {
						const size = Buffer.alloc(4);
						size.writeUInt32LE(entry.content.length, 0);
						return size;
					})(),
					literalLzssStream(entry.content),
				])
			: entry.content,
	);
	const total =
		dataOffset + payloads.reduce((sum, payload) => sum + payload.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("IPAC", 0, "ascii");
	archive.writeUInt16LE(entries.length, 4);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x2c;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x24);
		const payload = payloads[id] ?? Buffer.alloc(0);
		archive.writeUInt32LE(payload.length, record + 0x28);
		payload.copy(archive, offset);
		offset += payload.length;
	}
	return archive;
}

describe("IPAC archive", () => {
	it("decompresses IEL1-prefixed entries with the default LZSS variant", async () => {
		const content = Buffer.from("packed payload");
		const archive = buildIpac([
			{ name: "raw.bin", content: Buffer.from("aa") },
			{ name: "packed.bin", content, packed: true },
		]);
		await expectArchive({
			format: ipacFormat,
			archive,
			entries: [
				{ path: "raw.bin", size: 2, content: Buffer.from("aa") },
				{
					path: "packed.bin",
					size: 8 + literalLzssStream(content).length,
					content,
				},
			],
			metadata: { entryCount: 2 },
		});
	});
});
