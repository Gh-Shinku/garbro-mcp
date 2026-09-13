import { encodeCp932 } from "@garbro-mcp/core";
import { pinpaiArcxFormat } from "@garbro-mcp/formats";
import { describe, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x20;
const PACKED_HEADER_SIZE = 4;

interface Entry {
	name: string;
	payload: Buffer;
	/** Declared unpacked size for packed archives; defaults to the literal stream length. */
	unpackedSize?: number;
}

function buildArcx(entries: readonly Entry[], packed: boolean): Buffer {
	const payloads = entries.map((entry) => {
		if (!packed) return entry.payload;
		const stream = literalLzssStream(entry.payload);
		const wrapper = Buffer.alloc(PACKED_HEADER_SIZE + stream.length);
		wrapper.writeUInt32LE(entry.unpackedSize ?? entry.payload.length, 0);
		stream.copy(wrapper, PACKED_HEADER_SIZE);
		return wrapper;
	});
	const payloadOffset = INDEX_OFFSET + entries.length * RECORD_SIZE;
	const archive = Buffer.alloc(
		payloadOffset +
			payloads.reduce((total, payload) => total + payload.length, 0),
	);
	archive.write("arcx", 0, "ascii");
	archive.writeInt32LE(entries.length, 4);
	let offset = payloadOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		const payload = payloads[id] ?? Buffer.alloc(0);
		archive.writeUInt32LE(payload.length, record + 0x10);
		archive.writeUInt32LE(offset, record + 0x14);
		payload.copy(archive, offset);
		offset += payload.length;
	}
	return archive;
}

describe("Pinpai arcx resource archive", () => {
	it("extracts LZSS entries behind a declared unpacked size", async () => {
		const content = Buffer.from("packed payload");
		await expectArchive({
			format: pinpaiArcxFormat,
			archive: buildArcx([{ name: "script.dat", payload: content }], true),
			sourcePath: "sample.arcx",
			entries: [{ path: "script.dat", size: content.length, content }],
			metadata: { entryCount: 1, compressed: true },
		});
	});

	it("labels .b entries as bitmaps", async () => {
		const content = Buffer.from("bitmap payload");
		await expectArchive({
			format: pinpaiArcxFormat,
			archive: buildArcx([{ name: "CG001.B", payload: content }], true),
			sourcePath: "sample.arcx",
			entries: [{ path: "CG001.B", size: content.length, content }],
		});
	});

	it("keeps archives named wav stored", async () => {
		const content = Buffer.from("verbatim payload");
		await expectArchive({
			format: pinpaiArcxFormat,
			archive: buildArcx([{ name: "voice.wav", payload: content }], false),
			sourcePath: "WAV.arcx",
			entries: [{ path: "voice.wav", size: content.length, content }],
			metadata: { entryCount: 1, compressed: false },
		});
	});

	it("rejects a payload outside the file", async () => {
		const archive = buildArcx(
			[{ name: "a.dat", payload: Buffer.from("x") }],
			false,
		);
		archive.writeUInt32LE(archive.length, INDEX_OFFSET + 0x14);
		await expectArchive({
			format: pinpaiArcxFormat,
			archive,
			sourcePath: "sample.arcx",
			detected: false,
			entries: [],
		});
	});

	it("rejects an unsane entry count", async () => {
		const archive = buildArcx(
			[{ name: "a.dat", payload: Buffer.from("x") }],
			false,
		);
		archive.writeInt32LE(-1, 4);
		await expectArchive({
			format: pinpaiArcxFormat,
			archive,
			sourcePath: "sample.arcx",
			detected: false,
			entries: [],
		});
	});
});
