import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { BufferByteSource, GarbroError, encodeCp932 } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { abogadoPakFormat } from "../../packages/formats/src/abogado/pak.js";
import {
	KEY_TABLE,
	KEY_TABLE_COUNT,
	KEY_TABLE_SHA256,
} from "../../packages/formats/src/abogado/keytable.js";

const RECORD_SIZE = 0x48;

interface PakEntry {
	name: string;
	data: Buffer;
	/** The number of the substitution table written behind the entry, when the archive is one of the FS8. */
	key?: number;
}

interface PakParts {
	encryption?: number;
	entries: PakEntry[];
	/** A count other than the number of records, to try an index the reference turns down. */
	count?: number;
	/** Leaves the last few bytes of the file out. */
	truncate?: number;
}

function pakFile(parts: PakParts): Buffer {
	const count = parts.count ?? parts.entries.length;
	const head: Buffer = Buffer.alloc(4, 0x00);
	head.writeInt16LE(count, 0);
	head.writeInt16LE(parts.encryption ?? 0, 2);
	const encrypted = 0 !== (parts.encryption ?? 0);
	const records: Buffer = Buffer.alloc(Math.max(count, 0) * RECORD_SIZE, 0x00);
	const chunks: Buffer[] = [];
	let position = 4 + Math.max(count, 0) * RECORD_SIZE;
	parts.entries.forEach((entry, index) => {
		const at = index * RECORD_SIZE;
		if (at + RECORD_SIZE <= records.length) {
			encodeCp932(entry.name).copy(records, at, 0, 0x3f);
			records.writeUInt32LE(position, at + 0x40);
			records.writeUInt32LE(entry.data.length, at + 0x44);
		}
		chunks.push(entry.data);
		position += entry.data.length;
		if (encrypted) {
			const key: Buffer = Buffer.alloc(4, 0x00);
			key.writeInt32LE(entry.key ?? 0, 0);
			chunks.push(key);
			position += 4;
		}
	});
	const file = Buffer.concat([head, records, ...chunks]);
	const cut = parts.truncate ?? 0;
	return cut > 0 ? file.subarray(0, Math.max(0, file.length - cut)) : file;
}

async function open(
	data: Buffer,
): Promise<Awaited<ReturnType<typeof abogadoPakFormat.open>>> {
	return abogadoPakFormat.open(new BufferByteSource(data), "abogado.pak");
}

async function extract(
	handle: Awaited<ReturnType<typeof abogadoPakFormat.open>>,
	id: string,
): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("AbogadoPowers resource archive", () => {
	it("finds an archive by its index", async () => {
		const data = pakFile({
			entries: [{ name: "BACK.PFT", data: Buffer.from([1, 2, 3, 4]) }],
		});
		expect(
			await abogadoPakFormat.detect(new BufferByteSource(data), "abogado.pak"),
		).toBe(true);
	});

	it("declines an index the reference turns down", async () => {
		const parts: PakParts = {
			entries: [{ name: "BACK.PFT", data: Buffer.from([1, 2, 3, 4]) }],
		};
		for (const broken of [
			{ ...parts, count: 0 },
			{ ...parts, count: -1 },
			// A count the index of this file cannot hold.
			{ ...parts, count: 0x7fff },
			{ ...parts, encryption: 2 },
			{ ...parts, entries: [{ name: "   ", data: Buffer.alloc(4) }] },
			{ ...parts, truncate: 4 },
		]) {
			const data = pakFile(broken);
			expect(
				await abogadoPakFormat.detect(
					new BufferByteSource(data),
					"abogado.pak",
				),
			).toBe(false);
		}
	});

	it("reports the records of the index", async () => {
		const data = pakFile({
			entries: [
				{ name: "BACK.PFT", data: Buffer.from([1, 2]) },
				{ name: "SUB\\FRONT.KG", data: Buffer.from([3, 4, 5]) },
			],
		});
		const handle = await open(data);
		expect(handle.entries.map((entry) => entry.path)).toEqual([
			"BACK.PFT",
			"SUB/FRONT.KG",
		]);
		expect(handle.entries[0]?.size).toBe(2n);
		expect(handle.entries[1]?.rawPath).toBe("SUB\\FRONT.KG");
		expect(handle.metadata).toMatchObject({ entryCount: 2, encrypted: false });
	});

	it("hands out an entry of an archive that stands as it is", async () => {
		const data = pakFile({
			entries: [{ name: "BACK.PFT", data: Buffer.from([0x10, 0x20, 0x30]) }],
		});
		const handle = await open(data);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(await extract(handle, entry.id)).toEqual(
			Buffer.from([0x10, 0x20, 0x30]),
		);
	});

	it("puts every byte of an FS8 entry through the table behind it", async () => {
		const stored = Buffer.from([0x11, 0x22, 0x33, 0x44]);
		const data = pakFile({
			encryption: 1,
			entries: [{ name: "BACK.PFT", data: stored, key: 1 }],
		});
		const handle = await open(data);
		expect(handle.metadata).toMatchObject({ encrypted: true });
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const expected: Buffer = Buffer.alloc(stored.length);
		for (let index = 0; index < stored.length; index += 1) {
			expected[index] = KEY_TABLE[0x100 + (stored[index] ?? 0)] ?? 0;
		}
		expect(expected).not.toEqual(stored);
		expect(await extract(handle, entry.id)).toEqual(expected);
	});

	it("hands an entry out as it stands where the table number is no table", async () => {
		const stored = Buffer.from([0x11, 0x22, 0x33, 0x44]);
		for (const key of [-1, 0x80, 0x7fff]) {
			const data = pakFile({
				encryption: 1,
				entries: [{ name: "BACK.PFT", data: stored, key }],
			});
			const handle = await open(data);
			const entry = handle.entries[0];
			if (!entry) throw new Error("no entry");
			expect(await extract(handle, entry.id)).toEqual(stored);
		}
	});

	it("refuses an entry whose table number is not in the file", async () => {
		const data = pakFile({
			encryption: 1,
			entries: [{ name: "BACK.PFT", data: Buffer.from([1, 2, 3, 4]) }],
			// The four bytes of the table number behind the entry are left out of the file.
			truncate: 4,
		});
		const handle = await open(data);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		await expect(handle.openEntry(entry.id)).rejects.toThrow(GarbroError);
		await expect(handle.openEntry(entry.id)).rejects.toThrow(
			"Abogado entry carries no substitution table number",
		);
	});
});

describe("Abogado substitution tables", () => {
	it("holds the tables of the reference asset", () => {
		expect(KEY_TABLE.length).toBe(KEY_TABLE_COUNT * 0x100);
		expect(createHash("sha256").update(KEY_TABLE).digest("hex")).toBe(
			KEY_TABLE_SHA256,
		);
	});

	it("holds a permutation of the byte values in every table", () => {
		for (let table = 0; table < KEY_TABLE_COUNT; table += 1) {
			const seen = new Set<number>();
			for (let index = 0; index < 0x100; index += 1) {
				seen.add(KEY_TABLE[table * 0x100 + index] ?? 0);
			}
			expect(seen.size).toBe(0x100);
		}
	});
});
