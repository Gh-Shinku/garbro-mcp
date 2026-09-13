import { encodeCp932 } from "@garbro-mcp/core";
import { dlbFormat, dlbV0Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const NAME_SIZE = 0x0d;
const RECORD_SIZE = NAME_SIZE + 8;

interface Entry {
	name: string;
	content: Buffer;
}

/** A record is a fixed 0xD-byte name field, a data offset and a size, with payloads at the end. */
function buildRecords(entries: readonly Entry[]): {
	index: Buffer;
	body: Buffer;
} {
	const index = Buffer.alloc(RECORD_SIZE * entries.length);
	const body = Buffer.concat(entries.map((entry) => entry.content));
	let data = 0;
	for (const [id, entry] of entries.entries()) {
		const record = id * RECORD_SIZE;
		encodeCp932(entry.name).copy(index, record);
		index.writeUInt32LE(data, record + NAME_SIZE);
		index.writeUInt32LE(entry.content.length, record + NAME_SIZE + 4);
		data += entry.content.length;
	}
	return { index, body };
}

/** Version 1.00 announces itself with a 22-byte header holding the count, then indexes at 0x18. */
function buildDlb(entries: readonly Entry[]): Buffer {
	const { index, body } = buildRecords(entries);
	const header = Buffer.alloc(0x18);
	header.write("<< dlb file Ver1.00>>", 0, "latin1");
	header.writeInt16LE(entries.length, 0x16);
	const dataOffset = header.length + index.length;
	for (let id = 0; id < entries.length; id += 1) {
		const record = id * RECORD_SIZE + NAME_SIZE;
		index.writeUInt32LE(index.readUInt32LE(record) + dataOffset, record);
	}
	return Buffer.concat([header, index, body]);
}

/** The zero version keeps the count at 0, indexes at 2, and stores absolute offsets. */
function buildDlbV0(entries: readonly Entry[]): Buffer {
	const { index, body } = buildRecords(entries);
	const header = Buffer.alloc(2);
	header.writeInt16LE(entries.length, 0);
	const dataOffset = header.length + index.length;
	const first = dataOffset;
	if (entries.length > 0) {
		index.writeUInt32LE(first, NAME_SIZE);
	}
	for (let id = 1; id < entries.length; id += 1) {
		const record = id * RECORD_SIZE + NAME_SIZE;
		index.writeUInt32LE(index.readUInt32LE(record) + dataOffset, record);
	}
	return Buffer.concat([header, index, body]);
}

describe("UK2 engine DLB archive", () => {
	it("reads version 1.00 through its header signature", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: dlbFormat,
			archive: buildDlb([
				{ name: "one.dat", content: first },
				{ name: "two.dat", content: second },
			]),
			sourcePath: "sample.dlb",
			entries: [
				{ path: "one.dat", size: first.length, content: first },
				{ path: "two.dat", size: second.length, content: second },
			],
		});
	});

	it("rejects version 1.00 with a broken header", async () => {
		const archive = buildDlb([{ name: "one.dat", content: Buffer.from("x") }]);
		archive.write("<< dlb file Ver1.01>>", 0, "latin1");
		await expectArchive({
			format: dlbFormat,
			archive,
			sourcePath: "sample.dlb",
			detected: false,
			entries: [],
		});
	});

	it("reads version 0 through its aligned first offset", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: dlbV0Format,
			archive: buildDlbV0([
				{ name: "one.dat", content: first },
				{ name: "two.dat", content: second },
			]),
			sourcePath: "sample.DLB",
			entries: [
				{ path: "one.dat", size: first.length, content: first },
				{ path: "two.dat", size: second.length, content: second },
			],
		});
	});

	it("rejects version 0 when the first offset does not match", async () => {
		const archive = buildDlbV0([
			{ name: "one.dat", content: Buffer.from("x") },
		]);
		archive.writeUInt32LE(0, 0x0f);
		await expectArchive({
			format: dlbV0Format,
			archive,
			sourcePath: "sample.DLB",
			detected: false,
			entries: [],
		});
	});

	it("requires the dlb extension for version 0", async () => {
		const archive = buildDlbV0([
			{ name: "one.dat", content: Buffer.from("x") },
		]);
		await expectArchive({
			format: dlbV0Format,
			archive,
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});
});
