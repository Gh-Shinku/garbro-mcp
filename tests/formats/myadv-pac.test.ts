import { encodeCp932 } from "@garbro-mcp/core";
import { myAdvPacFormat } from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { describe, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

interface Entry {
	name: string;
	content: Buffer;
}

function buildPac(entries: readonly Entry[]): Buffer {
	const names = entries.map((entry) => {
		const encoded = encodeCp932(entry.name);
		return { encoded, packed: deflateSync(encoded) };
	});
	const indexSize =
		4 +
		names.reduce((total, name) => total + 12 + name.packed.length, 0) +
		entries.length * 12;
	const payloads = entries.map((entry) => deflateSync(entry.content));
	const archive = Buffer.alloc(
		indexSize + payloads.reduce((total, payload) => total + payload.length, 0),
	);
	archive.writeInt32LE(entries.length, 0);
	let position = 4;
	for (const name of names) {
		archive.writeInt32LE(name.encoded.length, position);
		archive.writeInt32LE(name.encoded.length, position + 4);
		archive.writeInt32LE(name.packed.length, position + 8);
		name.packed.copy(archive, position + 12);
		position += 12 + name.packed.length;
	}
	let payloadOffset = indexSize;
	for (const [id, entry] of entries.entries()) {
		const payload = payloads[id] ?? Buffer.alloc(0);
		archive.writeUInt32LE(payloadOffset, position);
		archive.writeUInt32LE(payload.length, position + 4);
		archive.writeUInt32LE(entry.content.length, position + 8);
		position += 12;
		payload.copy(archive, payloadOffset);
		payloadOffset += payload.length;
	}
	return archive;
}

describe("MyAdv PAC resource archive", () => {
	it("inflates CP932 names and entry payloads", async () => {
		await expectArchive({
			format: myAdvPacFormat,
			archive: buildPac([
				{ name: "画像\\一.bin", content: Buffer.from("first") },
				{ name: "script.txt", content: Buffer.from("second") },
			]),
			sourcePath: "sample.pac",
			entries: [
				{ path: "画像/一.bin", size: 5, content: Buffer.from("first") },
				{ path: "script.txt", size: 6, content: Buffer.from("second") },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects invalid compressed-name bounds", async () => {
		const archive = buildPac([{ name: "a", content: Buffer.from("x") }]);
		archive.writeInt32LE(0x101, 4);
		await expectArchive({
			format: myAdvPacFormat,
			archive,
			sourcePath: "sample.pac",
			detected: false,
			entries: [],
		});
	});

	it("rejects an out-of-bounds payload", async () => {
		const archive = buildPac([{ name: "a", content: Buffer.from("x") }]);
		const tableOffset = 16 + archive.readInt32LE(12);
		archive.writeUInt32LE(0xffffffff, tableOffset + 4);
		await expectArchive({
			format: myAdvPacFormat,
			archive,
			sourcePath: "sample.pac",
			detected: false,
			entries: [],
		});
	});
});
