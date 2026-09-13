import { Blowfish } from "@garbro-mcp/codecs";
import { encodeCp932 } from "@garbro-mcp/core";
import { aimsPackFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const DEFAULT_KEY = Buffer.from([
	0x7d, 0x73, 0xf6, 0xe4, 0xf5, 0x81, 0x5f, 0x7c, 0x78, 0x30, 0xc2, 0x36, 0xea,
	0x3e, 0x8a, 0x76, 0xf7, 0xe0, 0x48, 0xb5, 0x85, 0xd7, 0x77, 0x49, 0x4c, 0x3d,
	0xf5, 0x0c, 0xbb, 0xfb, 0x2e, 0x44, 0xfe, 0x25, 0xb7, 0xeb, 0xc7, 0xd9, 0x33,
	0xab, 0xa8, 0x2c, 0x64, 0xe8, 0xf0, 0xbd, 0xeb, 0x8d, 0x9d, 0x1d, 0xa2, 0xfc,
	0x59, 0x09, 0xaa, 0xa4,
]);

/** Produces bytes that GARbro's little-endian Blowfish decryptor turns back into `plain`. */
function encryptForGarbro(plain: Buffer, key: Buffer): Buffer {
	const blowfish = new Blowfish(key);
	const padded = Buffer.concat([
		plain,
		Buffer.alloc((8 - (plain.length % 8)) % 8),
	]);
	const output = Buffer.alloc(padded.length);
	for (let offset = 0; offset < padded.length; offset += 8) {
		const [left, right] = blowfish.encipherWords(
			padded.readUInt32LE(offset),
			padded.readUInt32LE(offset + 4),
		);
		output.writeUInt32LE(left, offset);
		output.writeUInt32LE(right, offset + 4);
	}
	return output;
}

function buildAims(
	entries: { name: string; content: Buffer; packed?: boolean }[],
): Buffer {
	const indexOffset = 8;
	const indexSize = entries.length * 0x50;
	const dataOffset = indexOffset + indexSize;
	const payloads = entries.map((entry) => {
		if (!entry.packed) return entry.content;
		const encrypted = encryptForGarbro(entry.content, DEFAULT_KEY);
		const header = Buffer.alloc(8);
		header.write("LZSS", 0, "ascii");
		header.writeUInt32LE(entry.content.length, 4);
		return Buffer.concat([header, encrypted]);
	});
	const total =
		dataOffset + payloads.reduce((sum, payload) => sum + payload.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("PACK", 0, "ascii");
	archive.writeInt32LE(entries.length, 4);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x50;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(0, record + 0x40);
		archive.writeUInt32LE(0, record + 0x44);
		archive.writeUInt32LE(offset, record + 0x48);
		const payload = payloads[id] ?? Buffer.alloc(0);
		archive.writeUInt32LE(payload.length, record + 0x4c);
		payload.copy(archive, offset);
		offset += payload.length;
	}
	return archive;
}

describe("AIMS PACK archive", () => {
	it("decrypts LZSS-tagged entries with the default Blowfish key", async () => {
		const secret = Buffer.from("AIMS encrypted payload");
		await expectArchive({
			format: aimsPackFormat,
			archive: buildAims([
				{ name: "plain.bin", content: Buffer.from("aa") },
				{ name: "scene.mus", content: secret, packed: true },
			]),
			sourcePath: "data.pac",
			entries: [
				{ path: "plain.bin", size: 2, content: Buffer.from("aa") },
				{
					path: "scene.mus",
					size: 8 + Math.ceil(secret.length / 8) * 8,
					content: secret,
				},
			],
			metadata: { entryCount: 2 },
		});
	});
});
