import { encodeCp932 } from "@garbro-mcp/core";
import { cgV2Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const DATA_OFFSET = 0x6000;
const RECORD_SIZE = 0x30;

interface CgEntry {
	name: string;
	content: Buffer;
	width?: number;
	height?: number;
}

function buildCg(entries: readonly CgEntry[]): Buffer {
	const records = entries.map((entry) => {
		const record = Buffer.alloc(RECORD_SIZE);
		encodeCp932(entry.name).copy(record, 0);
		record.writeUInt32LE(entry.width ?? 640, 0x24);
		record.writeUInt32LE(entry.height ?? 480, 0x28);
		record.writeUInt32LE(entry.content.length, 0x2c);
		return record;
	});
	const archive = Buffer.concat([
		Buffer.alloc(DATA_OFFSET),
		...entries.map((entry) => entry.content),
	]);
	let offset = 0;
	let position = 0;
	for (const [id, record] of records.entries()) {
		record.writeUInt32LE(offset, 0x20);
		record.copy(archive, position);
		position += RECORD_SIZE;
		offset += entries[id]?.content.length ?? 0;
	}
	return archive;
}

describe("Software House Parsley CG archive", () => {
	it("reads the fixed index region", async () => {
		const first = Buffer.from("image one");
		const second = Buffer.from("image two!");
		await expectArchive({
			format: cgV2Format,
			archive: buildCg([
				{ name: "cg001", content: first, width: 800, height: 600 },
				{ name: "cg002", content: second },
			]),
			sourcePath: "CG",
			entries: [
				{ path: "cg001", size: first.length, content: first },
				{ path: "cg002", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("stops at a zero byte", async () => {
		const content = Buffer.from("only image");
		const archive = buildCg([{ name: "cg001", content }]);
		archive.writeUInt8(0, RECORD_SIZE);
		await expectArchive({
			format: cgV2Format,
			archive,
			sourcePath: "CG",
			entries: [{ path: "cg001", size: content.length, content }],
		});
	});

	it("requires the CG file name", async () => {
		await expectArchive({
			format: cgV2Format,
			archive: buildCg([{ name: "cg001", content: Buffer.from("x") }]),
			sourcePath: "CGG",
			detected: false,
			entries: [],
		});
	});
});
