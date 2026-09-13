import { BufferByteSource } from "@garbro-mcp/core";
import { mokoProNnnnFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const KEY_FIRST = 1;
const KEY_SECOND = 0x23;

/** Mirrors GARbro `MokoCrypt.Decrypt`, which the fixture uses as an oracle while building payloads. */
function decryptMoko(input: Buffer): Buffer {
	const output = Buffer.from(input);
	for (let i = output.length - 2; i >= 0; i -= 1) {
		output[i] = (output[i] ?? 0) ^ (KEY_SECOND ^ (output[i + 1] ?? 0));
		output[i + 1] = (output[i + 1] ?? 0) ^ (KEY_FIRST ^ (output[i] ?? 0));
	}
	return output;
}

/**
 * Encrypts a payload by inverting the reference loop. Every byte but the last follows from the byte behind it,
 * and the last byte is found by trying all values against the reference loop itself.
 */
function encryptMoko(plain: Buffer): Buffer {
	const cipher = Buffer.alloc(plain.length);
	for (let i = 0; i < plain.length - 1; i += 1)
		cipher[i] = (plain[i + 1] ?? 0) ^ KEY_FIRST ^ KEY_SECOND;
	for (let candidate = 0; candidate < 0x100; candidate += 1) {
		cipher[plain.length - 1] = candidate;
		if (decryptMoko(cipher).equals(plain)) return cipher;
	}
	throw new Error("Plaintext is not reachable through the reference loop");
}

/** Wraps an encrypted payload in the container header. */
function buildNnnn(stream: Buffer, unpackedSize: number): Buffer {
	const header = Buffer.alloc(8);
	header.write("NNNN", 0, "latin1");
	header.writeInt32LE(unpackedSize, 4);
	return Buffer.concat([header, encryptMoko(stream)]);
}

async function expectDeclined(file: Buffer): Promise<void> {
	const source = new BufferByteSource(file);
	expect(await mokoProNnnnFormat.detect(source, "sample.dat")).toBe(false);
}

describe("Mokopro compressed file", () => {
	it("lists the single payload under the file name", async () => {
		const data = Buffer.from("hello mokopro");
		await expectArchive({
			format: mokoProNnnnFormat,
			sourcePath: "sample.dat",
			archive: buildNnnn(literalLzssStream(data), data.length),
			entries: [{ path: "sample.dat", size: data.length, content: data }],
			metadata: { entryCount: 1 },
		});
	});

	it("reports the packed and unpacked sizes of the entry", async () => {
		const data = Buffer.from("hello mokopro");
		const file = buildNnnn(literalLzssStream(data), data.length);
		const archive = await mokoProNnnnFormat.open(
			new BufferByteSource(file),
			"sample.dat",
		);
		expect(archive.entries[0]).toMatchObject({
			compressed: true,
			encrypted: true,
			size: BigInt(data.length),
			packedSize: BigInt(file.length),
		});
	});

	it("keeps a partially decoded payload", async () => {
		// The stream encodes three bytes while the header declares ten, so decoding stops at the stream end.
		const data = Buffer.from("hello mokopro");
		const file = buildNnnn(literalLzssStream(data.subarray(0, 3)), 10);
		const archive = await mokoProNnnnFormat.open(
			new BufferByteSource(file),
			"sample.dat",
		);
		const entry = archive.entries[0];
		if (!entry) throw new Error("Missing entry");
		const content = await consumeBuffer(await archive.openEntry(entry.id));
		expect(content).toEqual(data.subarray(0, 3));
	});

	it("lists an entry even when its payload does not decode", async () => {
		const header = Buffer.alloc(8);
		header.write("NNNN", 0, "latin1");
		header.writeInt32LE(4, 4);
		const file = Buffer.concat([header, Buffer.alloc(8, 0xff)]);
		const archive = await mokoProNnnnFormat.open(
			new BufferByteSource(file),
			"sample.dat",
		);
		expect(archive.entries).toHaveLength(1);
	});

	it("rejects a file without the format signature", async () => {
		const file = buildNnnn(literalLzssStream(Buffer.from("data")), 4);
		file.write("NOPE", 0, "latin1");
		await expectDeclined(file);
	});

	it("rejects a file without an unpacked size", async () => {
		const file = buildNnnn(literalLzssStream(Buffer.from("data")), 4);
		file.writeInt32LE(0, 4);
		await expectDeclined(file);
	});

	it("rejects a file that is shorter than its header", async () => {
		await expectDeclined(Buffer.from("NNNN"));
	});
});
