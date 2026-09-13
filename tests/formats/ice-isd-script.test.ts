import { BufferByteSource } from "@garbro-mcp/core";
import { isdScriptDescriptor, isdScriptFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 8;
const SIGNATURE = Buffer.from([0x54, 0x50, 0x57, 0x01]);
const MAX_OUTPUT = 0x4000000;

/** A literal run: a control byte below 0x40 is a count followed by that many bytes. */
function literals(data: Buffer): Buffer {
	if (data.length === 0 || data.length >= 0x40)
		throw new Error("literal runs are shorter than 0x40");
	return Buffer.concat([Buffer.from([data.length]), data]);
}

/** A repeat run: `0x3D + count` then the repeated byte, or `0x6F` and a word for longer runs. */
function repeat(value: number, count: number): Buffer {
	if (count < 3) throw new Error("repeat runs start at three");
	if (count <= 0x32) return Buffer.from([0x3d + count, value]);
	const head: Buffer = Buffer.from([0x6f]);
	const size: Buffer = Buffer.alloc(2);
	size.writeUInt16LE(count, 0);
	return Buffer.concat([head, size, Buffer.from([value])]);
}

/** Signature, unpacked size, the decoder's first word and then the control stream. */
function buildIsd(controls: Buffer, unpackedSize: number, seed = 0): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	header.writeInt32LE(unpackedSize, 4);
	const prefix: Buffer = Buffer.alloc(2, 0x00);
	prefix.writeUInt16LE(seed, 0);
	return Buffer.concat([header, prefix, controls]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("ice isd script", () => {
	it("declares the TPW signature and the isd extension", () => {
		expect(isdScriptFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(isdScriptDescriptor.extensions).toEqual(["isd"]);
	});

	it("unpacks literal and repeat runs", async () => {
		const expected: Buffer = Buffer.concat([
			Buffer.from([0x11, 0x22, 0x33, 0x44]),
			Buffer.alloc(3, 0x55),
		]);
		const stored = buildIsd(
			Buffer.concat([
				literals(Buffer.from([0x11, 0x22, 0x33, 0x44])),
				repeat(0x55, 3),
				Buffer.from([0x00]),
			]),
			expected.length,
		);
		const source = sourceOf(stored);
		expect(await isdScriptFormat.detect(source, "SCRIPT.ISD")).toBe(true);
		const archive = await isdScriptFormat.open(source, "SCRIPT.ISD");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"SCRIPT.bin",
			]);
			expect(archive.metadata).toMatchObject({
				script: "isd",
				compression: "tpw",
				unpackedSize: expected.length,
			});
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "script",
				unpackedSize: expected.length,
			});
			// The listed size is the stored payload, which is not the extracted length.
			expect(archive.entries[0]?.size).toBe(
				BigInt(stored.length - HEADER_SIZE),
			);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(expected);
		} finally {
			await archive.close();
		}
	});

	it("supports the long form of a repeat run", async () => {
		const expected: Buffer = Buffer.alloc(0x40, 0x7c);
		const stored = buildIsd(
			Buffer.concat([repeat(0x7c, 0x40), Buffer.from([0x00])]),
			expected.length,
		);
		const archive = await isdScriptFormat.open(sourceOf(stored), "SCRIPT.ISD");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(expected);
		} finally {
			await archive.close();
		}
	});

	it("leaves the rest zero when the terminator comes early", async () => {
		const stored = buildIsd(
			Buffer.concat([literals(Buffer.from([0xaa])), Buffer.from([0x00])]),
			4,
		);
		const archive = await isdScriptFormat.open(sourceOf(stored), "SCRIPT.ISD");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(Buffer.from([0xaa, 0x00, 0x00, 0x00]));
		} finally {
			await archive.close();
		}
	});

	it("leaves the rest zero when the stream ends without a terminator", async () => {
		// The TPW decoder breaks on end of input, so the remaining samples keep their zero fill.
		const stored = buildIsd(literals(Buffer.from([0xaa])), 4);
		const archive = await isdScriptFormat.open(sourceOf(stored), "SCRIPT.ISD");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(Buffer.from([0xaa, 0x00, 0x00, 0x00]));
		} finally {
			await archive.close();
		}
	});

	it("declines a truncated control word", async () => {
		// A long repeat run has a sixteen bit count; here only one of its bytes is present.
		const stored = buildIsd(Buffer.from([0x6f, 0x10]), 0x40);
		const archive = await isdScriptFormat.open(sourceOf(stored), "SCRIPT.ISD");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow(
				/Invalid Ice ISD script/,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a different signature", async () => {
		const stored = buildIsd(Buffer.from([0x00]), 1);
		stored[3] = 0x02;
		expect(await isdScriptFormat.detect(sourceOf(stored), "SCRIPT.ISD")).toBe(
			false,
		);
	});

	it("declines a size that is zero or unreasonably large", async () => {
		const zero = buildIsd(Buffer.from([0x00]), 0);
		expect(await isdScriptFormat.detect(sourceOf(zero), "SCRIPT.ISD")).toBe(
			false,
		);
		const huge = buildIsd(Buffer.from([0x00]), MAX_OUTPUT + 1);
		expect(await isdScriptFormat.detect(sourceOf(huge), "SCRIPT.ISD")).toBe(
			false,
		);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await isdScriptFormat.detect(
				sourceOf(SIGNATURE.subarray(0, 3)),
				"SCRIPT.ISD",
			),
		).toBe(false);
	});
});
