import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { flyingShinePdFormat } from "../../packages/formats/src/flying-shine/pd-legacy.js";

const RECORD_OFFSET = 0x48;
const RECORD_SIZE = 0x90;

interface PdRecord {
	name: string;
	data: Buffer;
}

/** Builds a `Pack` archive: the header, the fixed size records and then the payloads. */
function buildPd(
	records: PdRecord[],
	options: { version?: string } = {},
): Buffer {
	const version = options.version ?? "Only";
	let position = RECORD_OFFSET + records.length * RECORD_SIZE;
	const offsets = records.map((record) => {
		const offset = position;
		position += record.data.length;
		return offset;
	});
	const file = Buffer.alloc(position);
	file.write("Pack", 0, "latin1");
	file.write(version, 4, "latin1");
	file.writeInt32LE(records.length, 0x40);
	records.forEach((record, index) => {
		const at = RECORD_OFFSET + index * RECORD_SIZE;
		file.write(record.name, at, "latin1");
		file.writeBigInt64LE(BigInt(offsets[index] ?? 0), at + 0x80);
		file.writeUInt32LE(record.data.length, at + 0x88);
		record.data.copy(file, offsets[index] ?? 0);
	});
	return file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("flying-shine pd", () => {
	it("lists entries and extracts them", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload of another length");
		const file = buildPd([
			{ name: "IMAGE.PNG", data: first },
			{ name: "SCRIPT.DSF", data: second },
		]);
		const source = sourceOf(file);
		expect(await flyingShinePdFormat.detect(source)).toBe(true);
		const archive = await flyingShinePdFormat.open(source, "game.pd");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"IMAGE.PNG",
				"SCRIPT.DSF",
			]);
			expect(archive.entries.map((entry) => Number(entry.size))).toEqual([
				first.length,
				second.length,
			]);
			expect(archive.metadata).toMatchObject({ masked: false });
			expect(archive.entries[1]?.metadata).toMatchObject({ type: "script" });
			const entry = archive.entries[1];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				second,
			);
		} finally {
			await archive.close();
		}
	});

	it("unmasks every payload of a plus archive", async () => {
		const plain = Buffer.from([0x00, 0x11, 0xff, 0x7f]);
		const stored = Buffer.from(plain.map((value) => value ^ 0xff));
		const file = buildPd([{ name: "DATA.BIN", data: stored }], {
			version: "Plus",
		});
		const source = sourceOf(file);
		const archive = await flyingShinePdFormat.open(source, "plus.pd");
		try {
			expect(archive.metadata).toMatchObject({ masked: true });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.encrypted).toBe(true);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				plain,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines an unknown variant word", async () => {
		const file = buildPd([{ name: "A.BIN", data: Buffer.from("x") }], {
			version: "Nope",
		});
		expect(await flyingShinePdFormat.detect(sourceOf(file))).toBe(false);
	});

	it("declines an entry outside the file", async () => {
		const file = buildPd([{ name: "A.BIN", data: Buffer.from("payload") }]);
		file.writeBigInt64LE(0x10000n, RECORD_OFFSET + 0x80);
		expect(await flyingShinePdFormat.detect(sourceOf(file))).toBe(false);
	});

	it("declines an insane entry count", async () => {
		const file = buildPd([{ name: "A.BIN", data: Buffer.from("payload") }]);
		file.writeInt32LE(0x100000, 0x40);
		expect(await flyingShinePdFormat.detect(sourceOf(file))).toBe(false);
	});

	it("declines a record table that fills the file", async () => {
		const file = buildPd([{ name: "A.BIN", data: Buffer.from("payload") }]);
		file.writeInt32LE(0x1000, 0x40);
		expect(await flyingShinePdFormat.detect(sourceOf(file))).toBe(false);
	});

	it("declares the pack signature for the registry", () => {
		expect(flyingShinePdFormat.detection?.signatures?.[0]?.bytes).toEqual(
			Buffer.from("Pack", "latin1"),
		);
	});
});
