// The second shape of the Tactics archive (GARbro "ArcFormats/Tactics/ArcTactics.cs", class Arc2Opener),
// against files built in the test: the head of the engine and a flat list of the pictures of it behind the
// head. The reference reads that list and then refuses the archive unless it holds the password of the game,
// so this port lists the pictures and refuses each of them where its places are asked for.
import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { tactics2ArcFormat, tacticsArcFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";

function le32(value: number): Buffer {
	const out = Buffer.alloc(4);
	out.writeUInt32LE(value >>> 0, 0);
	return out;
}

/** One record of the flat list: the counts, then the name, and then the places of the picture. */
function record(
	name: Buffer,
	size: number,
	unpacked: number,
	data: Buffer,
): Buffer {
	return Buffer.concat([
		le32(size),
		le32(unpacked),
		le32(name.length),
		Buffer.alloc(8, 0x00), // the places of the record this port stands of no use of
		name,
		data,
	]);
}

/** An archive of the second shape, of the records given and the word of the end of the list. */
function arc2(records: Buffer[]): Buffer {
	const head = Buffer.alloc(0x10, 0x00);
	head.write("TACT", 0, "latin1");
	head.write("ICS_ARC_FILE", 4, "latin1");
	return Buffer.concat([head, ...records, le32(0), Buffer.alloc(0x10, 0x00)]);
}

async function archiveOf(data: Buffer) {
	const source = new BufferByteSource(data);
	expect(await tactics2ArcFormat.detect(source, "sample.arc")).toBe(true);
	return tactics2ArcFormat.open(source, "sample.arc");
}

describe("Tactics archive of the second shape", () => {
	it("reads the flat list of the pictures of the engine", async () => {
		const name = Buffer.from("first.g24", "latin1");
		const japanese = Buffer.from([
			0x82, 0xa0, 0x82, 0xa2, 0x2e, 0x62, 0x6d, 0x70,
		]); // "あい.bmp" of the places of the engine
		const archive = await archiveOf(
			arc2([
				record(name, 6, 0, Buffer.from([1, 2, 3, 4, 5, 6])),
				record(japanese, 4, 12, Buffer.from([9, 8, 7, 6])),
			]),
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"first.g24",
				"あい.bmp",
			]);
			const [first, second] = archive.entries;
			if (!first || !second) throw new Error("no entries");
			expect(Number(first.size)).toBe(6);
			expect(first.metadata).toMatchObject({ type: "image", unpackedSize: 6 });
			expect(first.compressed).toBe(false);
			expect(Number(second.size)).toBe(4);
			expect(second.metadata).toMatchObject({
				type: "image",
				unpackedSize: 12,
			});
			expect(second.compressed).toBe(true);
			expect(archive.metadata).toMatchObject({ count: 2, shape: "flat-list" });
		} finally {
			await archive.close();
		}
	});

	it("refuses a picture, of the password the reference stands of no place of the file for", async () => {
		const archive = await archiveOf(
			arc2([
				record(
					Buffer.from("first.g24", "latin1"),
					4,
					0,
					Buffer.from([1, 2, 3, 4]),
				),
			]),
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("no entry");
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "UNSUPPORTED_FEATURE",
			});
		} finally {
			await archive.close();
		}
	});

	it("stands of no file of another head, of no word of the end of the list or of a name beyond it", async () => {
		const good = arc2([
			record(
				Buffer.from("first.g24", "latin1"),
				4,
				0,
				Buffer.from([1, 2, 3, 4]),
			),
		]);
		// The word of the engine at 0 stands of the signature the walk of the places of a name is
		// registered under, which the registry checks before the walk of the list is asked.
		const signature = tactics2ArcFormat.detection?.signatures?.[0]?.bytes;
		expect(signature && Buffer.from(signature).toString("latin1")).toBe(
			"TACTICS_ARC_FILE",
		);
		for (const data of [
			// A file whose record stands short of its own places of the file.
			good.subarray(0, 0x18),
			// A name of more than the places of the file the reference stands of a name of.
			arc2([
				record(Buffer.alloc(0x101, 0x41), 4, 0, Buffer.from([1, 2, 3, 4])),
			]),
			// A picture whose places stand past the end of the file.
			Buffer.concat([
				Buffer.alloc(0x10, 0x00),
				le32(0x1000),
				le32(0),
				le32(4),
				Buffer.alloc(8),
				Buffer.from("a.bmp", "latin1"),
				Buffer.alloc(4, 0x00),
			]),
			// A list of no picture of the engine at all.
			Buffer.concat([Buffer.alloc(0x10, 0x00), le32(0)]),
		]) {
			const source = new BufferByteSource(data);
			expect(await tactics2ArcFormat.detect(source, "other.arc")).toBe(false);
		}
	});

	it("stands behind the first shape of the archive, which reads the same head", async () => {
		// The first shape of the archive stands of the same head and a packed index behind it, and it is
		// tried first; a file of this shape stands of it only where that index cannot be walked.
		const data = arc2([
			record(
				Buffer.from("first.g24", "latin1"),
				4,
				0,
				Buffer.from([1, 2, 3, 4]),
			),
		]);
		const source = new BufferByteSource(data);
		expect(await tacticsArcFormat.detect(source, "sample.arc")).toBe(false);
		expect(await tactics2ArcFormat.detect(source, "sample.arc")).toBe(true);
	});
});
