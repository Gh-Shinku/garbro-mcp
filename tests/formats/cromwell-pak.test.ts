import { BufferByteSource } from "@garbro-mcp/core";
import { cromwellPakFormat } from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const COUNT_OFFSET = 0x10;
const INDEX_OFFSET = 0x14;
const NAME_SIZE = 0xc;
const RECORD_SIZE = NAME_SIZE + 8;

interface Entry {
	name: string;
	content: Buffer;
}

/** Entry records carry GARbro's `Type`; the shared helper only checks paths and sizes. */
async function expectEntryTypes(
	archive: Buffer,
	types: readonly string[],
	sourcePath?: string,
): Promise<void> {
	const source = new BufferByteSource(archive);
	const listing = await cromwellPakFormat.open(
		source,
		sourcePath ?? "sample.bin",
	);
	try {
		expect(listing.entries.map((entry) => entry.metadata)).toEqual(
			types.map((type) => ({ type })),
		);
	} finally {
		await listing.close();
	}
}

function buildPak(signature: string, entries: readonly Entry[]): Buffer {
	const indexLength = entries.length * RECORD_SIZE;
	const dataOffset = INDEX_OFFSET + indexLength;
	const payloads = entries.map((entry) => deflateSync(entry.content));
	const archive = Buffer.alloc(
		dataOffset + payloads.reduce((sum, payload) => sum + payload.length, 0),
	);
	archive.write(signature, 0, "ascii");
	archive.writeInt32LE(entries.length, COUNT_OFFSET);
	let payloadOffset = 0;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		Buffer.from(entry.name, "latin1").copy(archive, record, 0, NAME_SIZE - 1);
		archive.writeUInt32LE(dataOffset + payloadOffset, record + NAME_SIZE);
		archive.writeUInt32LE(entry.content.length, record + NAME_SIZE + 4);
		const payload = payloads[id] ?? Buffer.alloc(0);
		payload.copy(archive, dataOffset + payloadOffset);
		payloadOffset += payload.length;
	}
	return archive;
}

describe("cromwell graphic PAK resource archive", () => {
	it("reads a graphic archive", async () => {
		const first = Buffer.from("first bitmap");
		const second = Buffer.from("second bitmap");
		const archive = buildPak("Graphic PackData", [
			{ name: "first.bmp", content: first },
			{ name: "second.bmp", content: second },
		]);
		await expectArchive({
			format: cromwellPakFormat,
			archive,
			metadata: { entryCount: 2 },
			entries: [
				{ path: "first.bmp", size: first.length, content: first },
				{ path: "second.bmp", size: second.length, content: second },
			],
		});
		await expectEntryTypes(archive, ["image", "image"]);
	});

	it("reads a voice archive as audio", async () => {
		const payload = Buffer.from("voice payload");
		const archive = buildPak("Voice PackData. ", [
			{ name: "track.bin", content: payload },
		]);
		await expectArchive({
			format: cromwellPakFormat,
			archive,
			entries: [{ path: "track.bin", size: payload.length, content: payload }],
		});
		await expectEntryTypes(archive, ["audio"]);
	});

	it("retypes a graphic archive named VOICE as audio", async () => {
		const payload = Buffer.from("voice payload");
		const archive = buildPak("Graphic PackData", [
			{ name: "track.bin", content: payload },
		]);
		await expectArchive({
			format: cromwellPakFormat,
			archive,
			sourcePath: "/games/VOICE.PAK",
			entries: [{ path: "track.bin", size: payload.length, content: payload }],
		});
		await expectEntryTypes(archive, ["audio"], "/games/VOICE.PAK");
	});

	it("rejects a foreign signature", async () => {
		const archive = buildPak("Graphic PackData", [
			{ name: "first.bmp", content: Buffer.from("bitmap") },
		]);
		archive.write("XXXXXXX PackData", 0, "ascii");
		const source = new BufferByteSource(archive);
		expect(await cromwellPakFormat.detect(source)).toBe(false);
	});

	it("rejects an out-of-range payload offset", async () => {
		const archive = buildPak("Graphic PackData", [
			{ name: "first.bmp", content: Buffer.from("bitmap") },
		]);
		archive.writeUInt32LE(0x1000, INDEX_OFFSET + NAME_SIZE);
		const source = new BufferByteSource(archive);
		expect(await cromwellPakFormat.detect(source)).toBe(false);
	});

	it("rejects a nameless record", async () => {
		const archive = buildPak("Graphic PackData", [
			{ name: "first.bmp", content: Buffer.from("bitmap") },
		]);
		archive.fill(0, INDEX_OFFSET, INDEX_OFFSET + NAME_SIZE);
		const source = new BufferByteSource(archive);
		expect(await cromwellPakFormat.detect(source)).toBe(false);
	});
});
