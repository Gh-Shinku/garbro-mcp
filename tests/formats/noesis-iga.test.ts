import { encodeCp932 } from "@garbro-mcp/core";
import { igaFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x10;

/**
 * Inverse of GARbro `ReadPackedUInt`: the byte stream is a base-128 encoding of `(value << 1) | 1`
 * whose non-final digits must be even, because the decoder stops as soon as a read value is odd.
 */
function packUInt(value: number): number[] {
	const target = (value << 1) | 1;
	const digits: number[] = [];
	let rest = target;
	do {
		digits.unshift(rest % 128);
		rest = Math.floor(rest / 128);
	} while (rest > 0);
	const last = digits.length - 1;
	for (const [index, digit] of digits.entries()) {
		if (index !== last && digit % 2 !== 0)
			throw new Error(`Value ${value} is not representable`);
	}
	return digits;
}

function packString(text: string): number[] {
	const bytes: number[] = [];
	for (const value of encodeCp932(text)) bytes.push(...packUInt(value));
	return bytes;
}

/** XOR inverse of the payload transform GARbro applies on extraction. */
function encryptPayload(data: Buffer, script: boolean): Buffer {
	const payload = Buffer.from(data);
	const key = script ? 0xff : 0;
	for (let position = 0; position < payload.length; position += 1)
		payload[position] =
			(payload[position] ?? 0) ^ (((position + 2) ^ key) & 0xff);
	return payload;
}

interface IgaEntry {
	name: string;
	content: Buffer;
}

function buildIga(entries: readonly IgaEntry[]): Buffer {
	const names: number[] = [];
	const nameOffsets: number[] = [];
	for (const entry of entries) {
		nameOffsets.push(names.length);
		names.push(...packString(entry.name));
	}
	const nameLength = names.length;
	const records: number[] = [];
	let dataOffset = 0;
	for (const [id, entry] of entries.entries()) {
		records.push(...packUInt(nameOffsets[id] ?? 0));
		records.push(...packUInt(dataOffset));
		records.push(...packUInt(entry.content.length));
		dataOffset += entry.content.length;
	}
	const header = Buffer.alloc(INDEX_OFFSET);
	header.write("IGA0", 0, "ascii");
	return Buffer.concat([
		header,
		Buffer.from(packUInt(records.length)),
		Buffer.from(records),
		Buffer.from(packUInt(nameLength)),
		Buffer.from(names),
		...entries.map((entry) =>
			encryptPayload(entry.content, entry.name.endsWith(".s")),
		),
	]);
}

describe("Noesis IGA resource archive", () => {
	it("reads packed records and decrypts payloads", async () => {
		// The reference decoder can only represent values whose packed digits stay even, so the
		// fixture sticks to names built from low bytes.
		const first = Buffer.from("script body");
		const second = Buffer.from("data payload");
		await expectArchive({
			format: igaFormat,
			archive: buildIga([
				{ name: "0.1", content: first },
				{ name: "2/3.4", content: second },
			]),
			sourcePath: "sample.iga",
			entries: [
				{ path: "0.1", size: first.length, content: first },
				{ path: "2/3.4", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a missing signature", async () => {
		const archive = buildIga([{ name: "1.2", content: Buffer.from("x") }]);
		archive.write("IGA1", 0, "ascii");
		await expectArchive({
			format: igaFormat,
			archive,
			sourcePath: "sample.iga",
			detected: false,
			entries: [],
		});
	});
});
