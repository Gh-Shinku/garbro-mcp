import { BufferByteSource } from "@garbro-mcp/core";
import { encodeQdo, qdoScriptFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0x51, 0x44, 0x4f, 0x5f]);
const TAG = Buffer.from("QDO_SHO", "latin1");
const FLAG_OFFSET = 0x0c;
const SCRIPT_DATA_POS = 0x0e;

/**
 * The plain script as the converter leaves it: the flag byte at index 12 is zero, and the body starts at
 * `0x0E`. Bytes 7..11 and 13 are filler the reference never reads.
 */
const PLAIN = Buffer.concat([
	TAG,
	Buffer.from([0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00]),
	Buffer.from("zzz hello script body", "latin1"),
]);

/** The plain script with its body obfuscated and the flag set, i.e. what ships on disk. */
function buildEncrypted(plain = PLAIN): Buffer {
	const data = Buffer.from(plain);
	encodeQdo(data, SCRIPT_DATA_POS);
	data[FLAG_OFFSET] = 1;
	return data;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("redzone qdo script", () => {
	it("declares the QDO_ signature and no extension", () => {
		expect(qdoScriptFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
	});

	it("unscrambles the body and clears the flag", async () => {
		const stored = buildEncrypted();
		// The stored body does not read as text.
		expect(stored.subarray(SCRIPT_DATA_POS).toString("latin1")).not.toBe(
			PLAIN.subarray(SCRIPT_DATA_POS).toString("latin1"),
		);
		const source = sourceOf(stored);
		expect(await qdoScriptFormat.detect(source, "SCRIPT.QDO")).toBe(true);
		const archive = await qdoScriptFormat.open(source, "SCRIPT.QDO");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"SCRIPT.txt",
			]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "script" });
			expect(archive.metadata).toMatchObject({
				script: "qdo",
				encrypted: true,
				scriptDataOffset: SCRIPT_DATA_POS,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			// The body is rewritten in place, so the listed size is the extracted one.
			expect(entry.size).toBe(BigInt(stored.length));
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(PLAIN);
			expect(output[FLAG_OFFSET]).toBe(0);
			// The bytes before the body are untouched apart from the flag.
			expect(output.subarray(0, FLAG_OFFSET)).toEqual(
				stored.subarray(0, FLAG_OFFSET),
			);
			expect(output[FLAG_OFFSET + 1]).toBe(stored[FLAG_OFFSET + 1]);
		} finally {
			await archive.close();
		}
	});

	it("leaves an already converted script alone", async () => {
		const plain = Buffer.from(PLAIN);
		plain[FLAG_OFFSET] = 0;
		const archive = await qdoScriptFormat.open(sourceOf(plain), "SCRIPT.QDO");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			// With the flag clear the reference hands the data back unchanged.
			expect(output).toEqual(plain);
		} finally {
			await archive.close();
		}
	});

	it("inverts the reference's encryption step", () => {
		// `ConvertBack` adds thirteen to the inverted byte; the port's decoder must undo exactly that.
		const original = Buffer.from("plain text 123", "latin1");
		const scrambled = Buffer.from(original);
		encodeQdo(scrambled, 0);
		expect(scrambled).not.toEqual(original);
		const restored = Buffer.from(scrambled);
		for (let i = 0; i < restored.length; i += 1) {
			restored[i] = ~((restored[i] ?? 0) - 13) & 0xff;
		}
		expect(restored).toEqual(original);
	});

	it("declines a file whose tag is shorter than the seven bytes IsScript compares", async () => {
		const stored = buildEncrypted();
		// The four byte signature still matches, so this exercises the port's own check.
		stored.write("QDO_XHO", 0, "latin1");
		expect(await qdoScriptFormat.detect(sourceOf(stored), "SCRIPT.QDO")).toBe(
			false,
		);
	});

	it("declines a different signature", async () => {
		const stored = buildEncrypted();
		stored[3] = 0x60;
		expect(await qdoScriptFormat.detect(sourceOf(stored), "SCRIPT.QDO")).toBe(
			false,
		);
	});

	it("declines a file without room for the script body", async () => {
		expect(
			await qdoScriptFormat.detect(
				sourceOf(Buffer.from("QDO_SHO", "latin1")),
				"S.QDO",
			),
		).toBe(false);
	});
});
