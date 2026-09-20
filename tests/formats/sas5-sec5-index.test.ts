import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { readFile, writeFile } from "node:fs/promises";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { sas5IarFormat } from "../../packages/formats/src/sas5/iar.js";
import {
	readSec5Res2Section,
	readSec5ResrSection,
} from "../../packages/formats/src/sas5/sec5-index.js";
import { withCompanionFiles } from "../helpers/companion.js";

const HEADER_SIZE = 0x10;

/** The places of the picture of the walk of the places of the picture of the places of the picture of the
 * engine of the first kind. */
function resr(
	records: {
		name: string;
		type: string;
		kind: string;
		archive: string;
		id: number;
	}[],
): Buffer {
	const parts: Buffer[] = [];
	const count = Buffer.alloc(4);
	count.writeInt32LE(records.length, 0);
	parts.push(count);
	for (const record of records) {
		const strings = Buffer.from(
			`${record.name}\0${record.type}\0${record.kind}\0`,
			"latin1",
		);
		const tail = Buffer.concat([
			Buffer.from(`${record.archive}\0`, "latin1"),
			(() => {
				const id = Buffer.alloc(4);
				id.writeInt32LE(record.id, 0);
				return id;
			})(),
		]);
		const length = Buffer.alloc(4);
		length.writeInt32LE(tail.length, 0);
		parts.push(strings, length, tail);
	}
	return Buffer.concat(parts);
}

/** The places of the picture of the walk of the places of the picture of the picture of the walk of the
 * places of the picture of the places of the picture of the engine of the second kind. */
class Res2Builder {
	readonly #table: Buffer[] = [];
	readonly #offsets = new Map<string, number>();
	readonly #stream: number[] = [];
	#tableSize = 0;

	string(value: string): number {
		const known = this.#offsets.get(value);
		if (known !== undefined) {
			this.#stream.push(0x90, known);
			return known;
		}
		const bytes = Buffer.from(value, "latin1");
		const offset = this.#tableSize;
		const length = Buffer.alloc(4);
		length.writeInt32LE(bytes.length, 0);
		this.#table.push(length, bytes);
		this.#tableSize += 4 + bytes.length;
		this.#offsets.set(value, offset);
		this.#stream.push(0x90, offset);
		return offset;
	}

	integer(value: number): void {
		// The places of the picture of the walk of the places of the picture of the sound stand of the places
		// of the picture of the walk of the places of the picture of the picture of their own where the places
		// of the picture of the walk of the places of the picture stand within the places of the picture of
		// the walk of the places of the picture of the walk of them of their own.
		if (value >= 0 && value < 0x10) this.#stream.push(value & 0x0f);
		else {
			const bytes = Buffer.alloc(4);
			bytes.writeInt32LE(value, 0);
			this.#stream.push(0x83, ...bytes);
		}
	}

	skip(): void {
		this.#stream.push(0x00);
	}

	build(): Buffer {
		const table = Buffer.concat(this.#table);
		const head = Buffer.alloc(4);
		head.writeInt32LE(table.length, 0);
		const count = Buffer.alloc(4);
		count.writeInt32LE(1, 0);
		return Buffer.concat([head, table, count, Buffer.from(this.#stream)]);
	}
}

/** The places of the picture of the walk of the places of the picture of the place of the picture of the
 * walk of the places of the picture of the engine of the name `SEC5`. */
function sec5(sectionName: string, payload: Buffer): Buffer {
	const out = Buffer.alloc(HEADER_SIZE + 8 + payload.length + 4, 0x00);
	out.write("SEC5", 0, "latin1");
	out.write(sectionName, HEADER_SIZE, "latin1");
	out.writeUInt32LE(payload.length, HEADER_SIZE + 4);
	payload.copy(out, HEADER_SIZE + 8);
	out.write("ENDS", HEADER_SIZE + 8 + payload.length, "latin1");
	return out;
}

describe("SAS5 engine resource names", () => {
	it("reads the places of the picture of the walk of the places of the picture of the places of the picture of the engine of the first kind", () => {
		const map = readSec5ResrSection(
			resr([
				{
					name: "cg/ev01.g",
					type: "image",
					kind: "file-iar",
					archive: "cg.iar",
					id: 3,
				},
				{
					name: "bg/room.d",
					type: "image",
					kind: "file-war",
					archive: "bg.war",
					id: 0,
				},
				// The places of the picture of the walk of the places of the picture of the places of the
				// picture of the engine of another kind stand of the places of the picture of the walk of the
				// places of the picture of the place of the picture of the walk of them of no places of the
				// picture of the walk of them.
				{ name: "x", type: "y", kind: "file-other", archive: "z.iar", id: 1 },
			]),
		);
		expect(map?.get("cg.iar")?.get(3)).toEqual({
			name: "cg/ev01.g",
			type: "image",
		});
		expect(map?.get("bg.war")?.get(0)).toEqual({
			name: "bg/room.d",
			type: "image",
		});
		expect(map?.get("z.iar")).toBeUndefined();
		expect(readSec5ResrSection(Buffer.alloc(4))).toBeUndefined();
	});

	it("reads the places of the picture of the walk of the places of the picture of the places of the picture of the engine of the second kind", () => {
		const builder = new Res2Builder();
		builder.string("cg/ev02.g");
		builder.string("image");
		builder.string("file-iar");
		builder.integer(2);
		builder.string("path");
		builder.string("cg.iar");
		builder.string("arc-index");
		builder.integer(7);
		builder.string("note");
		builder.skip();
		const map = readSec5Res2Section(builder.build());
		expect(map?.get("cg.iar")?.get(7)).toEqual({
			name: "cg/ev02.g",
			type: "image",
		});
	});

	it("turns away the places of the picture of the walk of the places of the picture of the places of the picture of the engine of no places of the picture of the walk of them", () => {
		expect(readSec5Res2Section(Buffer.alloc(4))).toBeUndefined();
		const broken = new Res2Builder();
		broken.string("a");
		broken.string("b");
		broken.string("c");
		broken.integer(1);
		broken.string("path");
		const payload = broken.build();
		expect(readSec5Res2Section(payload)).toBeUndefined();
	});

	it("stands the places of the picture of the walk of the places of the picture of the names of the picture of the walk of it beside the places of the picture of the walk of the places of the picture of the archive", async () => {
		const archive = (() => {
			const data = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
			const out = Buffer.alloc(0x28 + data.length, 0x00);
			out.write("iar ", 0, "latin1");
			out.writeInt16LE(1, 4);
			out.writeInt32LE(1, 0x18);
			out.writeInt32LE(2, 0x1c);
			out.writeUInt32LE(0x28, 0x20);
			out.writeUInt32LE(0x2c, 0x24);
			data.copy(out, 0x28);
			return out;
		})();
		const index = sec5(
			"RESR",
			resr([
				{
					name: "cg/ev01.g",
					type: "image",
					kind: "file-iar",
					archive: "cg.iar",
					id: 1,
				},
			]),
		);
		await withCompanionFiles(
			"cg.iar",
			{ "adv.sec5": index },
			async (mainPath) => {
				await writeFile(mainPath, archive);
				const handle = await sas5IarFormat.open(
					new BufferByteSource(await readFile(mainPath)),
					mainPath,
				);
				expect(handle.entries.map((entry) => entry.path)).toEqual([
					"cg#00000",
					"cg/ev01.g",
				]);
				const named = handle.entries[1];
				if (!named) throw new Error("no entry");
				expect(await consumeBuffer(await handle.openEntry(named.id))).toEqual(
					Buffer.from([5, 6, 7, 8]),
				);
			},
		);
	});
});
