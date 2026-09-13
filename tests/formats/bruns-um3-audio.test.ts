import { BufferByteSource } from "@garbro-mcp/core";
import { um3AudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0xb0, 0x98, 0x98, 0xac]);
const SCRAMBLE_SIZE = 0x800;

/** A stand-in for an Ogg stream: `OggS` followed by page data that fills the scrambled region. */
function buildOgg(size = 0x900): Buffer {
	const ogg: Buffer = Buffer.alloc(size, 0x00);
	ogg.write("OggS", 0, "latin1");
	ogg[4] = 0x00;
	ogg[5] = 0x02;
	for (let i = 6; i < ogg.length; i += 1) ogg[i] = (i * 5) & 0xff;
	return ogg;
}

function scramble(ogg: Buffer, size = SCRAMBLE_SIZE): Buffer {
	const stored = Buffer.from(ogg);
	const end = Math.min(size, stored.length);
	for (let i = 0; i < end; i += 1) stored[i] = (stored[i] ?? 0) ^ 0xff;
	return stored;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("bruns um3 audio", () => {
	it("declares the inverted OggS signature", () => {
		expect(um3AudioFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		// The signature is `OggS` with every byte inverted.
		expect(Buffer.from(SIGNATURE.map((byte) => byte ^ 0xff))).toEqual(
			Buffer.from("OggS", "latin1"),
		);
	});

	it("restores the scrambled header and leaves the rest alone", async () => {
		const ogg = buildOgg();
		const stored = scramble(ogg);
		// The stored file does not read as an Ogg stream.
		expect(stored.subarray(0, 4).toString("latin1")).not.toBe("OggS");
		const source = sourceOf(stored);
		expect(await um3AudioFormat.detect(source, "BGM01.UM3")).toBe(true);
		const archive = await um3AudioFormat.open(source, "BGM01.UM3");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.ogg"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({
				audio: "ogg",
				encrypted: true,
				scrambledBytes: SCRAMBLE_SIZE,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			// Inverting bytes keeps the length, so the listed size is the extracted one.
			expect(entry.size).toBe(BigInt(stored.length));
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(ogg);
			expect(output.readUInt32BE(0)).toBe(0x4f676753);
			// Bytes beyond the scrambled region were never touched.
			expect(output.subarray(SCRAMBLE_SIZE)).toEqual(
				stored.subarray(SCRAMBLE_SIZE),
			);
		} finally {
			await archive.close();
		}
	});

	it("scrambles a file that is shorter than the region in full", async () => {
		const ogg = buildOgg(0x40);
		const stored = scramble(ogg, 0x40);
		const archive = await um3AudioFormat.open(sourceOf(stored), "BGM02.UM3");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(ogg);
		} finally {
			await archive.close();
		}
	});

	it("declines a file whose descrambled header is not an Ogg stream", async () => {
		// Scrambling an Ogg but then breaking a byte of the restored magic.
		const stored = scramble(buildOgg());
		stored[1] = (stored[1] ?? 0) ^ 0x20;
		expect(await um3AudioFormat.detect(sourceOf(stored), "BGM01.UM3")).toBe(
			false,
		);
	});

	it("declines a file with the plain OggS signature", async () => {
		expect(await um3AudioFormat.detect(sourceOf(buildOgg()), "BGM01.UM3")).toBe(
			false,
		);
	});

	it("declines a file shorter than the signature", async () => {
		expect(
			await um3AudioFormat.detect(
				sourceOf(SIGNATURE.subarray(0, 3)),
				"BGM01.UM3",
			),
		).toBe(false);
	});
});
