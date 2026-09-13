import { encodeCp932 } from "@garbro-mcp/core";
import { crowdPckFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 4;
const RECORD_SIZE = 0xc;

interface Entry {
	name: string;
	content: Buffer;
}

/** The index holds offset and size per entry; the null-terminated names follow the whole index. */
function buildPck(entries: readonly Entry[]): Buffer {
	const indexSize = RECORD_SIZE * entries.length;
	const dataOffset = INDEX_OFFSET + indexSize;
	const names = Buffer.concat(
		entries.map((entry) =>
			Buffer.concat([encodeCp932(entry.name), Buffer.from([0])]),
		),
	);
	const body = Buffer.concat(entries.map((entry) => entry.content));
	const archive = Buffer.alloc(dataOffset + names.length + body.length);
	archive.writeInt32LE(entries.length, 0);
	let data = dataOffset + names.length;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		archive.writeUInt32LE(0, record);
		archive.writeUInt32LE(data, record + 4);
		archive.writeUInt32LE(entry.content.length, record + 8);
		data += entry.content.length;
	}
	names.copy(archive, dataOffset);
	body.copy(archive, dataOffset + names.length);
	return archive;
}

describe("Crowd engine PCK archive", () => {
	it("reads the name table behind the index", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: crowdPckFormat,
			archive: buildPck([
				{ name: "one.dat", content: first },
				{ name: "two.dat", content: second },
			]),
			sourcePath: "sample.pck",
			entries: [
				{ path: "one.dat", size: first.length, content: first },
				{ path: "two.dat", size: second.length, content: second },
			],
		});
	});

	it("rejects an empty entry count", async () => {
		const archive = buildPck([{ name: "one.dat", content: Buffer.from("x") }]);
		archive.writeInt32LE(0, 0);
		await expectArchive({
			format: crowdPckFormat,
			archive,
			sourcePath: "sample.pck",
			detected: false,
			entries: [],
		});
	});

	it("rejects an offset inside the index", async () => {
		const archive = buildPck([{ name: "one.dat", content: Buffer.from("x") }]);
		archive.writeUInt32LE(0, INDEX_OFFSET + 4);
		await expectArchive({
			format: crowdPckFormat,
			archive,
			sourcePath: "sample.pck",
			detected: false,
			entries: [],
		});
	});

	it("rejects an unterminated name", async () => {
		const archive = buildPck([{ name: "one.dat", content: Buffer.from("x") }]);
		// Replace the terminator with a non-zero byte and fill the remaining window.
		archive.fill(0x41, INDEX_OFFSET + RECORD_SIZE, archive.length);
		await expectArchive({
			format: crowdPckFormat,
			archive,
			sourcePath: "sample.pck",
			detected: false,
			entries: [],
		});
	});
});
