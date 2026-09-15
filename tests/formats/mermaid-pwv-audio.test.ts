import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	hasPwvHeader,
	mermaidPwvAudioFormat,
} from "../../packages/formats/src/mermaid/pwv-audio.js";

/**
 * A stream: the NUL the file opens with, the sixteen bytes the opcode behind it copies — a wave header among
 * them — and then the opcodes of the picture itself.
 */
function pwvFile(body: Buffer): Buffer {
	const head: Buffer = Buffer.alloc(16 + 1, 0x00);
	head.write("RIFF", 1, "latin1");
	head.writeUInt32LE(4 + body.length, 5);
	head.write("WAVE", 9, "latin1");
	return Buffer.concat([head, body]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.pwv"): Promise<Buffer> {
	const handle = await mermaidPwvAudioFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Mermaid compressed audio", () => {
	it("finds a stream of its own name", async () => {
		expect(
			await mermaidPwvAudioFormat.detect(
				sourceOf(pwvFile(Buffer.alloc(0))),
				"cg.pwv",
			),
		).toBe(true);
		// The reference reads this format from the name alone, so any other name leaves it alone.
		expect(
			await mermaidPwvAudioFormat.detect(
				sourceOf(pwvFile(Buffer.alloc(0))),
				"cg.wav",
			),
		).toBe(false);
	});

	it("declines a file that holds no wave behind the NUL", async () => {
		const data = pwvFile(Buffer.alloc(0));
		data.write("WAVX", 9, "latin1");
		expect(hasPwvHeader(data)).toBe(false);
		expect(await mermaidPwvAudioFormat.detect(sourceOf(data), "cg.pwv")).toBe(
			false,
		);
	});

	it("lists the wave it holds", async () => {
		const handle = await mermaidPwvAudioFormat.open(
			sourceOf(pwvFile(Buffer.alloc(0))),
			"dir/cg.pwv",
		);
		expect(handle.entries).toHaveLength(1);
		expect(handle.entries[0]?.path).toBe("cg.wav");
		expect(handle.metadata).toMatchObject({ audio: "wav" });
	});

	it("copies a block of the wave verbatim", async () => {
		const out = await extract(
			pwvFile(Buffer.from([0x00, ...Buffer.alloc(16, 0x77)])),
		);
		expect(out.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(out.subarray(16, 32)).toEqual(Buffer.alloc(16, 0x77));
	});

	it("widens eight bit samples with a byte of nothing behind each", async () => {
		const samples = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
		const out = await extract(
			pwvFile(Buffer.concat([Buffer.from([1]), samples])),
		);
		expect(out.subarray(16, 32)).toEqual(
			Buffer.from([1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8, 0]),
		);
	});

	it("signs eight bit samples with a byte of ones behind each", async () => {
		const samples = Buffer.from([
			0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
		]);
		const out = await extract(
			pwvFile(Buffer.concat([Buffer.from([8]), samples])),
		);
		expect(out.subarray(16, 32)).toEqual(
			Buffer.from([
				0x80, 0xff, 0x81, 0xff, 0x82, 0xff, 0x83, 0xff, 0x84, 0xff, 0x85, 0xff,
				0x86, 0xff, 0x87, 0xff,
			]),
		);
	});

	it("takes a block as long as the byte behind its opcode", async () => {
		const long: Buffer = Buffer.alloc(20, 0x5a);
		const out = await extract(
			pwvFile(
				Buffer.concat([
					Buffer.from([15, 20]),
					long,
					Buffer.from([15, 4, 9, 9, 9, 9]),
				]),
			),
		);
		expect(out.subarray(16, 36)).toEqual(long);
		expect(out.subarray(36, 40)).toEqual(Buffer.from([9, 9, 9, 9]));
	});

	it("repeats the block before a block the stream cannot fill", async () => {
		// The opcode takes four bytes but the stream holds two, so the block of the op before it shows through.
		const out = await extract(
			pwvFile(
				Buffer.concat([
					Buffer.from([15, 4, 1, 2, 3, 4]),
					Buffer.from([15, 4, 5, 6]),
				]),
			),
		);
		expect(out.subarray(16, 36)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6, 3, 4]));
	});

	it("refuses an opcode it does not know", async () => {
		await expect(
			extract(pwvFile(Buffer.from([7, 0x11, 0x22]))),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("ends at an opcode with nothing behind it", async () => {
		// An opcode the format does not know is the last byte of the file, which is where the stream ends.
		const out = await extract(pwvFile(Buffer.from([7])));
		expect(out).toHaveLength(16);
	});

	it("refuses a stream that ends inside an opcode", async () => {
		const samples = Buffer.from([1, 2, 3]);
		await expect(
			extract(pwvFile(Buffer.concat([Buffer.from([1]), samples]))),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});
});
