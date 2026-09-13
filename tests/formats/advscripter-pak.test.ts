import { BufferByteSource } from "@garbro-mcp/core";
import { advscripterPakFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const INDEX_START = 0x28;
const RECORD_SIZE = 0x30;
const NAME_SIZE = 0x20;

interface File {
	name: string;
	content: Buffer;
}

interface BuildOptions {
	version: number;
	/** Header key at 0x1C, used by every version except 1, 2, 5 and 6. */
	key?: number;
	packed?: boolean;
}

function rotateLeft(value: number, bits: number): number {
	return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

/** Applies the inverse of the reader's transform to one field. */
function encodeField(
	plain: number,
	version: number,
	key: number,
	rotateBits: number,
	shiftBits: number,
): number {
	if (version === 1 || version === 5) return plain;
	const effective = version === 2 || version === 6 ? 0xffffffff : key;
	const transformed =
		version === 9 ? rotateLeft(plain, rotateBits) : (plain << shiftBits) >>> 0;
	return (transformed ^ effective) >>> 0;
}

/**
 * Builds an ADVScripter archive. Packed payloads are literal-only LZSS streams, optionally masked with 0xFF for
 * versions 5 to 8, and the payload offsets are absolute.
 */
function buildAdvPak(files: readonly File[], options: BuildOptions): Buffer {
	const { version } = options;
	const key = options.key ?? 0;
	const stored = files.map((file) =>
		options.packed ? literalLzssStream(file.content) : file.content,
	);
	const payloadSize = stored.reduce((sum, body) => sum + body.length, 0);
	const dataStart = INDEX_START + files.length * RECORD_SIZE;
	const archive = Buffer.alloc(dataStart + payloadSize);
	archive.write("MD002", 0, "latin1");
	archive.write("00V", 0x21, "latin1");
	archive.writeUInt32LE(key, 0x1c);
	archive.writeUInt8(0x30 + version, 0x20);
	archive.writeInt32LE(files.length, 0x24);
	const keyBytes = Buffer.alloc(4);
	keyBytes.writeUInt32LE(key, 0);
	let payload = dataStart;
	files.forEach((file, id) => {
		const record = INDEX_START + id * RECORD_SIZE;
		const name = Buffer.alloc(NAME_SIZE);
		Buffer.from(file.name, "latin1").copy(name, 0);
		if (version === 4 || version === 8 || version === 9)
			for (let i = 0; i < 28; i += 1)
				name[i] = (name[i] ?? 0) ^ (keyBytes[i & 3] ?? 0);
		name.copy(archive, record);
		archive.writeInt32LE(options.packed ? 1 : 0, record + 0x20);
		archive.writeUInt32LE(
			encodeField(payload, version, key, 17, 1),
			record + 0x24,
		);
		archive.writeUInt32LE(
			encodeField(file.content.length, version, key, 18, 2),
			record + 0x28,
		);
		archive.writeUInt32LE(
			encodeField(stored[id]?.length ?? 0, version, key, 19, 3),
			record + 0x2c,
		);
		const body = Buffer.from(stored[id] ?? Buffer.alloc(0));
		if (version >= 5 && version <= 8)
			for (let i = 0; i < body.length; i += 1) body[i] = (body[i] ?? 0) ^ 0xff;
		body.copy(archive, payload);
		payload += body.length;
	});
	return archive;
}

describe("ADVScripter engine resource archive", () => {
	it("lists stored entries of a version 1 archive", async () => {
		const first = Buffer.from("first advscripter payload");
		const second = Buffer.from("second");
		await expectArchive({
			format: advscripterPakFormat,
			archive: buildAdvPak(
				[
					{ name: "one.bin", content: first },
					{ name: "two.bin", content: second },
				],
				{ version: 1 },
			),
			entries: [
				{ path: "one.bin", size: first.length, content: first },
				{ path: "two.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2, version: 1 },
		});
	});

	it("reads a version 3 archive whose fields are shifted and keyed", async () => {
		const content = Buffer.from("version three payload");
		await expectArchive({
			format: advscripterPakFormat,
			archive: buildAdvPak([{ name: "one.bin", content }], {
				version: 3,
				key: 0x13572468,
			}),
			entries: [{ path: "one.bin", size: content.length, content }],
			metadata: { version: 3 },
		});
	});

	it("reads a version 2 archive with the all-ones key", async () => {
		const content = Buffer.from("version two payload");
		await expectArchive({
			format: advscripterPakFormat,
			archive: buildAdvPak([{ name: "one.bin", content }], { version: 2 }),
			entries: [{ path: "one.bin", size: content.length, content }],
			metadata: { version: 2 },
		});
	});

	it("reads a version 9 archive with rotated fields and an encrypted name", async () => {
		const content = Buffer.from("version nine payload");
		await expectArchive({
			format: advscripterPakFormat,
			archive: buildAdvPak([{ name: "dir\\one.bin", content }], {
				version: 9,
				key: 0x22446688,
			}),
			entries: [{ path: "dir\\one.bin", size: content.length, content }],
			metadata: { version: 9 },
		});
	});

	it("unmasks and decodes packed payloads of a version 8 archive", async () => {
		const unpacked = Buffer.from("packed version eight payload");
		await expectArchive({
			format: advscripterPakFormat,
			archive: buildAdvPak([{ name: "one.bin", content: unpacked }], {
				version: 8,
				key: 0x0000beef,
				packed: true,
			}),
			entries: [{ path: "one.bin", size: unpacked.length, content: unpacked }],
			metadata: { version: 8 },
		});
	});

	it("unmasks packed payloads of a version 5 archive", async () => {
		const unpacked = Buffer.from("packed version five payload");
		await expectArchive({
			format: advscripterPakFormat,
			archive: buildAdvPak([{ name: "one.bin", content: unpacked }], {
				version: 5,
				packed: true,
			}),
			entries: [{ path: "one.bin", size: unpacked.length, content: unpacked }],
			metadata: { version: 5 },
		});
	});

	it("rejects a missing marker", async () => {
		const archive = buildAdvPak(
			[{ name: "one.bin", content: Buffer.alloc(4) }],
			{
				version: 3,
			},
		);
		archive.write("XXV", 0x21, "latin1");
		await expectDeclined(archive);
	});

	it("rejects a version digit outside the supported range", async () => {
		const archive = buildAdvPak(
			[{ name: "one.bin", content: Buffer.alloc(4) }],
			{
				version: 3,
			},
		);
		archive.writeUInt8(0x30, 0x20);
		await expectDeclined(archive);
	});

	it("rejects a payload outside the archive", async () => {
		const archive = buildAdvPak(
			[{ name: "one.bin", content: Buffer.alloc(4) }],
			{
				version: 1,
			},
		);
		archive.writeUInt32LE(0x1000, INDEX_START + 0x24);
		await expectDeclined(archive);
	});

	it("rejects an insane entry count", async () => {
		const archive = buildAdvPak(
			[{ name: "one.bin", content: Buffer.alloc(4) }],
			{
				version: 1,
			},
		);
		archive.writeInt32LE(0x40000, 0x24);
		await expectDeclined(archive);
	});
});

async function expectDeclined(archive: Buffer): Promise<void> {
	const source = new BufferByteSource(archive);
	expect(await advscripterPakFormat.detect(source, "sample.pak")).toBe(false);
}
