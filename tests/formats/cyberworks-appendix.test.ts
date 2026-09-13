import { BufferByteSource } from "@garbro-mcp/core";
import { cyberworksAppendixFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const TOC_NUM_LENGTH = 8;
/** The count word doubles as the signature, so its low byte has to be the slash. */
const COUNT = 0x12f;
const TOC_OFFSET = 4 + COUNT * 2;

interface Fixture {
	id: number;
	content: Buffer;
	/** Two type bytes, or `undefined` for a record without a usable extension. */
	extension?: string;
	packed?: boolean;
	/** Overrides the stored size field, for placement tests. */
	offsetOverride?: number;
}

/** Encodes one decimal field, least significant digit last. */
function encodeDecimal(value: number): Buffer {
	const field = Buffer.alloc(TOC_NUM_LENGTH);
	let remaining = value;
	for (let i = TOC_NUM_LENGTH - 1; i >= 0; i -= 1) {
		field[i] = ((remaining % 10) ^ 0x7f) & 0xff;
		remaining = Math.floor(remaining / 10);
	}
	return field;
}

/** Builds the uncompressed table, whose record offsets are relative to the payload area. */
function buildTocBody(fixtures: readonly Fixture[]): Buffer {
	const records: Buffer[] = [];
	let payloadOffset = 0;
	for (const fixture of fixtures) {
		const stored = fixture.packed
			? literalLzssStream(fixture.content)
			: fixture.content;
		const typeBytes =
			fixture.extension === undefined
				? Buffer.from([0, 0])
				: Buffer.from(fixture.extension, "latin1");
		const record = Buffer.alloc(4 + 16 + typeBytes.length);
		record.writeInt32LE(16 + typeBytes.length, 0);
		record.writeUInt32LE(fixture.id, 4);
		record.writeUInt32LE(fixture.content.length, 8);
		record.writeUInt32LE(stored.length, 12);
		record.writeUInt32LE(fixture.offsetOverride ?? payloadOffset, 16);
		typeBytes.copy(record, 20);
		records.push(record);
		payloadOffset += stored.length;
	}
	return Buffer.concat(records);
}

/** Builds an archive whose payload area starts right behind the packed table. */
function packArchive(body: Buffer, payloads: readonly Buffer[]): Buffer {
	const packed = literalLzssStream(body);
	const payloadSize = payloads.reduce(
		(sum, payload) => sum + payload.length,
		0,
	);
	const dataOffset = TOC_OFFSET + TOC_NUM_LENGTH * 2 + packed.length;
	const archive = Buffer.alloc(dataOffset + payloadSize);
	archive.writeInt32LE(COUNT, 0);
	encodeDecimal(body.length).copy(archive, TOC_OFFSET);
	encodeDecimal(packed.length).copy(archive, TOC_OFFSET + TOC_NUM_LENGTH);
	packed.copy(archive, TOC_OFFSET + TOC_NUM_LENGTH * 2);
	let cursor = dataOffset;
	for (const payload of payloads) {
		payload.copy(archive, cursor);
		cursor += payload.length;
	}
	return archive;
}

function storedBytes(fixtures: readonly Fixture[]): Buffer[] {
	return fixtures.map((fixture) =>
		fixture.packed ? literalLzssStream(fixture.content) : fixture.content,
	);
}

function buildArchive(fixtures: readonly Fixture[]): Buffer {
	return packArchive(buildTocBody(fixtures), storedBytes(fixtures));
}

async function expectDeclined(archive: Buffer): Promise<void> {
	const source = new BufferByteSource(archive);
	expect(await cyberworksAppendixFormat.detect(source, "sample.appendix")).toBe(
		false,
	);
}

describe("WendyBell resource archive", () => {
	it("lists stored and packed entries with typed names", async () => {
		const image = Buffer.from("stored image payload");
		const sound = Buffer.from("packed sound payload");
		const fixtures: Fixture[] = [
			{ id: 1, content: image, extension: "b0" },
			{ id: 2, content: sound, extension: "j0", packed: true },
		];
		await expectArchive({
			format: cyberworksAppendixFormat,
			archive: buildArchive(fixtures),
			entries: [
				{ path: "000001.b0", size: image.length, content: image },
				{ path: "000002.j0", size: sound.length, content: sound },
			],
			metadata: { entryCount: 2, hasImages: true },
		});
	});

	it("keeps a record without a usable extension unnamed", async () => {
		const content = Buffer.from("untyped payload");
		await expectArchive({
			format: cyberworksAppendixFormat,
			archive: buildArchive([{ id: 7, content }]),
			entries: [{ path: "000007", size: content.length, content }],
			metadata: { entryCount: 1, hasImages: false },
		});
	});

	it("keeps the entries of an archive and drops an out-of-range record", async () => {
		const content = Buffer.from("payload");
		const kept = buildArchive([{ id: 1, content, extension: "k0" }]);
		await expectArchive({
			format: cyberworksAppendixFormat,
			archive: kept,
			entries: [{ path: "000001.k0", size: content.length, content }],
		});
		// A single record whose payload does not fit leaves the archive without entries.
		const fixtures: Fixture[] = [
			{ id: 1, content, extension: "k0", offsetOverride: 0x10000 },
		];
		await expectDeclined(
			packArchive(buildTocBody(fixtures), storedBytes(fixtures)),
		);
	});

	it("rejects a file whose first byte is not the signature", async () => {
		const archive = buildArchive([{ id: 1, content: Buffer.from("x") }]);
		archive.writeUInt8(0x2e, 0);
		await expectDeclined(archive);
	});

	it("rejects a table offset outside the file", async () => {
		const archive = buildArchive([{ id: 1, content: Buffer.from("x") }]);
		archive.writeInt32LE(0x7fff, 0);
		await expectDeclined(archive);
	});

	it("rejects an unpacked size that is too small", async () => {
		const archive = buildArchive([{ id: 1, content: Buffer.from("x") }]);
		encodeDecimal(4).copy(archive, TOC_OFFSET);
		await expectDeclined(archive);
	});

	it("rejects a zero packed size", async () => {
		const archive = buildArchive([{ id: 1, content: Buffer.from("x") }]);
		encodeDecimal(0).copy(archive, TOC_OFFSET + TOC_NUM_LENGTH);
		await expectDeclined(archive);
	});

	it("rejects a table stream that is shorter than declared", async () => {
		const archive = buildArchive([{ id: 1, content: Buffer.from("x") }]);
		encodeDecimal(0x800).copy(archive, TOC_OFFSET);
		await expectDeclined(archive);
	});

	it("rejects an empty table", async () => {
		const body = Buffer.alloc(0x40);
		await expectDeclined(packArchive(body, []));
	});

	it("rejects a record that is too small for its fields", async () => {
		const fixtures: Fixture[] = [{ id: 1, content: Buffer.from("x") }];
		const body = buildTocBody(fixtures);
		body.writeInt32LE(0x10, 0);
		await expectDeclined(packArchive(body, storedBytes(fixtures)));
	});

	it("rejects a later record with a non-positive size", async () => {
		const fixtures: Fixture[] = [
			{ id: 1, content: Buffer.from("first") },
			{ id: 2, content: Buffer.from("second") },
		];
		const body = buildTocBody(fixtures);
		body.writeInt32LE(0, 0x16);
		await expectDeclined(packArchive(body, storedBytes(fixtures)));
	});
});
