import { encodeCp932 } from "@garbro-mcp/core";
import { bananaPkFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";
import { describe, it } from "vitest";

function obfuscateName(name: string): Buffer {
	const plain = encodeCp932(name);
	const stored = Buffer.alloc(plain.length);
	let key = plain.length + 1;
	for (let index = 0; index < plain.length; index += 1) {
		stored[index] = ((plain[index] ?? 0) + key) & 0xff;
		key -= 1;
	}
	return stored;
}

function buildBananaPk(
	entries: { name: string; content: Buffer; packed?: boolean }[],
): Buffer {
	const indexParts: Buffer[] = [];
	const payloads: Buffer[] = [];
	for (const entry of entries) {
		const stored = obfuscateName(entry.name);
		const nameField = Buffer.concat([Buffer.from([stored.length]), stored]);
		const payload = entry.packed
			? literalLzssStream(entry.content)
			: entry.content;
		payloads.push(payload);
		const offsetField = Buffer.alloc(8);
		indexParts.push(Buffer.concat([nameField, offsetField]));
	}
	const indexSize = indexParts.reduce((sum, part) => sum + part.length, 0);
	const dataOffset = 4 + indexSize;
	const total =
		dataOffset + payloads.reduce((sum, payload) => sum + payload.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeInt32LE(entries.length, 0);
	let position = 4;
	let offset = dataOffset;
	for (const [id, part] of indexParts.entries()) {
		part.copy(archive, position);
		const payload = payloads[id] ?? Buffer.alloc(0);
		const offsetField = position + part.length - 8;
		archive.writeUInt32BE(offset, offsetField);
		archive.writeUInt32BE(payload.length, offsetField + 4);
		payload.copy(archive, offset);
		offset += payload.length;
		position += part.length;
	}
	return archive;
}

describe("BANANA Shu-Shu PK archive", () => {
	it("de-obfuscates names and decompresses .scr entries", async () => {
		const script = Buffer.from("script body");
		await expectArchive({
			format: bananaPkFormat,
			archive: buildBananaPk([
				{ name: "data.bin", content: Buffer.from("plain") },
				{ name: "start.scr", content: script, packed: true },
			]),
			sourcePath: "data.pk",
			entries: [
				{ path: "data.bin", size: 5, content: Buffer.from("plain") },
				{
					path: "start.scr",
					size: literalLzssStream(script).length,
					content: script,
				},
			],
			metadata: { entryCount: 2 },
		});
	});
});
