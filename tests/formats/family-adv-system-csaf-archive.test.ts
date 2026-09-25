import { Buffer } from "node:buffer";
import { createCipheriv, createHash } from "node:crypto";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	csafArchiveFormat,
	csafBlockKey,
	csafKey,
	readCsafLayout,
} from "../../packages/formats/src/family-adv-system/csaf-archive.js";

const HEAD_SIZE = 0x20;
const PAGE_SIZE = 0x1000;
const ENTRY_SIZE = 0x18;
const ENTRY_FIRST = 0x10;
const NAMES_STRIDE = 10;
const DEFAULT_KEY = "江ノ島の南";
const DEFAULT_IV = Buffer.from("FamilyAdvSystem ", "ascii");

interface WantedEntry {
	name: string;
	payload: Buffer;
}

/** The names of an archive, every one of them closed by a pair of nothing and eight bytes of its own. */
function nameBlock(entries: WantedEntry[]): Buffer {
	const parts: Buffer[] = [];
	for (const entry of entries) {
		parts.push(
			Buffer.from(entry.name, "utf16le"),
			Buffer.alloc(NAMES_STRIDE, 0x00),
		);
	}
	const names = Buffer.concat(parts);
	// The names are kept wrapped as one run, so their length has to stand in whole blocks.
	const padded = Math.ceil(names.length / 16) * 16;
	if (padded === names.length) return names;
	return Buffer.concat([names, Buffer.alloc(padded - names.length, 0x00)]);
}

function layoutOf(count: number): number {
	return ((count * ENTRY_SIZE + 0x1f) & -PAGE_SIZE) + 0xfe0;
}

/**
 * An archive of this engine, built the other way round from the reader: the index with a digest of itself in
 * the head, the names behind it, and the payloads on pages of their own. A wrapped archive keeps its names and
 * its pages wrapped with the keys the reader derives, and the index of it stands as it is.
 */
function buildCsaf(entries: WantedEntry[], encrypted: boolean): Buffer {
	const names = nameBlock(entries);
	const indexSize = layoutOf(entries.length);
	const index = Buffer.alloc(indexSize + names.length, 0x00);
	names.copy(index, indexSize);
	// The payloads stand on page boundaries, since a place is counted in whole pages.
	const payloadAt =
		Math.ceil((HEAD_SIZE + indexSize + names.length) / PAGE_SIZE) * PAGE_SIZE;
	const pages: Buffer[] = [];
	for (const [id, entry] of entries.entries()) {
		const place = payloadAt + pages.length * PAGE_SIZE;
		index.writeUInt32LE(place / PAGE_SIZE, ENTRY_FIRST + id * ENTRY_SIZE);
		index.writeUInt32LE(
			entry.payload.length,
			ENTRY_FIRST + id * ENTRY_SIZE + 4,
		);
		const pageCount = Math.max(1, Math.ceil(entry.payload.length / PAGE_SIZE));
		for (let part = 0; part < pageCount; part += 1) {
			const page = Buffer.alloc(PAGE_SIZE, 0x00);
			entry.payload.copy(
				page,
				0,
				part * PAGE_SIZE,
				Math.min(entry.payload.length, (part + 1) * PAGE_SIZE),
			);
			pages.push(page);
		}
	}
	const key = csafKey(DEFAULT_KEY);
	let storedNames = names;
	if (encrypted) {
		const cipher = createCipheriv(
			"aes-256-cbc",
			csafBlockKey(key, 0),
			DEFAULT_IV,
		);
		cipher.setAutoPadding(false);
		storedNames = Buffer.concat([cipher.update(names), cipher.final()]);
	}
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write("CSAF", 0, "latin1");
	head.writeUInt32LE((0x10000 | (encrypted ? 0x80000000 : 0)) >>> 0, 4);
	head.writeInt32LE(entries.length, 8);
	head.writeUInt32LE(names.length, 0x0c);
	createHash("md5").update(index).digest().copy(head, 0x10);
	const body: Buffer[] = [head, index.subarray(0, indexSize), storedNames];
	let written = HEAD_SIZE + index.length;
	while (written < payloadAt) {
		const size = Math.min(PAGE_SIZE, payloadAt - written);
		body.push(Buffer.alloc(size, 0x00));
		written += size;
	}
	for (const [id, page] of pages.entries()) {
		if (!encrypted) {
			body.push(page);
			continue;
		}
		const pageStart = payloadAt + id * PAGE_SIZE;
		const cipher = createCipheriv(
			"aes-256-cbc",
			csafBlockKey(key, pageStart >> 12),
			DEFAULT_IV,
		);
		cipher.setAutoPadding(false);
		body.push(Buffer.concat([cipher.update(page), cipher.final()]));
	}
	return Buffer.concat(body);
}

async function list(data: Buffer) {
	return csafArchiveFormat.open(new BufferByteSource(data), "arc.lib");
}

async function extract(data: Buffer, id: string) {
	const archive = await list(data);
	const entry = archive.entries.find((candidate) => candidate.id === id);
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await archive.openEntry(entry.id));
}

describe("Family Adv System resource archive", () => {
	const entries: WantedEntry[] = [
		{ name: "first.txt", payload: Buffer.from("hello", "latin1") },
		{ name: "second.bin", payload: Buffer.alloc(0x1200, 0x41) },
	];

	it("reads the head and the shape its flags have to keep", () => {
		const data = buildCsaf(entries, false);
		const layout = readCsafLayout(data);
		expect(layout?.count).toBe(2);
		expect(layout?.encrypted).toBe(false);
		expect(layout?.indexSize).toBe(layoutOf(2));
		const wrongFlags = Buffer.from(data);
		wrongFlags.writeUInt32LE(0x10002, 4);
		expect(readCsafLayout(wrongFlags)).toBeUndefined();
		const wrongWord = Buffer.from(data);
		wrongWord.write("CSAB", 0, "latin1");
		expect(readCsafLayout(wrongWord)).toBeUndefined();
	});

	it("lists the names of an archive whose index matches its own digest", async () => {
		const archive = await list(buildCsaf(entries, false));
		expect(archive.entries.map((entry) => entry.path.split("/").pop())).toEqual(
			["first.txt", "second.bin"],
		);
		expect(archive.metadata?.encrypted).toBe(false);
	});

	it("hands over the payload of every entry", async () => {
		const data = buildCsaf(entries, false);
		const first = entries[0];
		const second = entries[1];
		if (!first || !second) throw new Error("the fixtures stand in the test");
		expect([...(await extract(data, "0"))]).toEqual([...first.payload]);
		expect([...(await extract(data, "1"))]).toEqual([...second.payload]);
	});

	it("reads an archive whose names and pages are wrapped", async () => {
		const data = buildCsaf(entries, true);
		const layout = readCsafLayout(data);
		expect(layout?.encrypted).toBe(true);
		const archive = await list(data);
		expect(archive.entries.map((entry) => entry.path.split("/").pop())).toEqual(
			["first.txt", "second.bin"],
		);
		const second = entries[1];
		if (!second) throw new Error("the fixtures stand in the test");
		expect([...(await extract(data, "1"))]).toEqual([...second.payload]);
	});

	it("turns away an archive that does not match its own digest", async () => {
		const data = buildCsaf(entries, false);
		data[HEAD_SIZE + 0x10] = (data[HEAD_SIZE + 0x10] ?? 0) ^ 0xff;
		await expect(list(data)).rejects.toThrow(/digest/);
	});

	it("hands over nothing for an entry that holds nothing", async () => {
		const data = buildCsaf(
			[{ name: "empty.dat", payload: Buffer.alloc(0, 0x00) }],
			false,
		);
		expect((await extract(data, "0")).length).toBe(0);
	});
});
