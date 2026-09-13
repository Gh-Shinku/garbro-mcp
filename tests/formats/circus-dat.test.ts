import { encodeCp932 } from "@garbro-mcp/core";
import { circusDatFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 4;

interface Entry {
	name: string;
	content: Buffer;
}

/**
 * Records are a fixed-width name field plus one offset word, and the announced count is one more than the
 * number of entries because the final record only supplies an offset. Payloads start behind the index
 * region, which covers all announced records.
 */
function buildCircus(entries: readonly Entry[], nameLength: number): Buffer {
	const announced = entries.length + 1;
	const indexSize = (nameLength + 4) * announced;
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeInt32LE(announced, 0);
	let position = dataOffset;
	const offsets: number[] = [];
	for (const entry of entries) {
		offsets.push(position);
		position += entry.content.length;
	}
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * (nameLength + 4);
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offsets[id] ?? 0, record + nameLength);
	}
	let write = dataOffset;
	for (const entry of entries) {
		entry.content.copy(archive, write);
		write += entry.content.length;
	}
	return archive;
}

describe("Circus DAT resource archive", () => {
	for (const nameLength of [0x24, 0x30, 0x3c]) {
		it(`reads records with ${nameLength.toString(16)}-byte name fields`, async () => {
			const first = Buffer.from("first body");
			const second = Buffer.from("second body");
			await expectArchive({
				format: circusDatFormat,
				archive: buildCircus(
					[
						{ name: "one.dat", content: first },
						{ name: "two.dat", content: second },
					],
					nameLength,
				),
				sourcePath: "sample.dat",
				entries: [
					{ path: "one.dat", size: first.length, content: first },
					{ path: "two.dat", size: second.length, content: second },
				],
			});
		});
	}

	it("rejects a layout whose first name tail matches the offset gap", async () => {
		const nameLength = 0x24;
		const first = Buffer.from("body of text");
		const second = Buffer.from("second body");
		const archive = buildCircus(
			[
				{ name: "one.dat", content: first },
				{ name: "two.dat", content: second },
			],
			nameLength,
		);
		// The heuristic compares the last four bytes of the first name field with the gap between the
		// first two offsets, so writing that gap there must reject the candidate width.
		const firstOffset = archive.readUInt32LE(INDEX_OFFSET + nameLength);
		const secondOffset = archive.readUInt32LE(
			INDEX_OFFSET + nameLength * 2 + 4,
		);
		archive.writeUInt32LE(
			secondOffset - firstOffset,
			INDEX_OFFSET + nameLength - 4,
		);
		await expectArchive({
			format: circusDatFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});

	it("rejects a count that is not above one", async () => {
		const content = Buffer.from("body");
		const archive = buildCircus([{ name: "one.dat", content }], 0x24);
		archive.writeInt32LE(1, 0);
		await expectArchive({
			format: circusDatFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});

	it("requires the dat extension", async () => {
		const content = Buffer.from("body");
		await expectArchive({
			format: circusDatFormat,
			archive: buildCircus([{ name: "one.dat", content }], 0x24),
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});
});
