import { BufferByteSource } from "@garbro-mcp/core";
import { kaasPdFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_DESCRIPTOR_SIZE = 16;
const RECORD_SIZE = 8;

interface Spec {
	payload: Buffer;
}

type Scheme = "discovery" | "old";

/**
 * Bounds of the index obfuscation: the opener subtracts a per byte value, so the fixtures add it back.
 */
function byteMask(scheme: Scheme, index: number, key: number): number {
	const k = index + 14;
	if (scheme === "old") {
		const r = (9 - Math.imul(Math.imul(k & 7, k + 5), key * 0x77)) | 0;
		return r & 0xff;
	}
	const r =
		((Math.imul(k, 0x6b) % Math.trunc(k / 2 + 1)) +
			Math.imul(Math.imul(key * 0x3b, k + 11), k % (k + 17))) |
		0;
	return r & 0xff;
}

/** Lays out a KAAS PD archive with an obfuscated index. */
function buildPd(
	specs: readonly Spec[],
	options?: {
		scheme?: Scheme;
		key?: number;
		indexOffset?: number;
		/** Points the first record into the index to exercise placement checks. */
		zeroOffset?: boolean;
	},
): Buffer {
	const key = options?.key ?? 0x5d;
	const scheme = options?.scheme ?? "discovery";
	const count = specs.length;
	const recordBlock = Buffer.alloc(count * RECORD_SIZE);
	const payloads: Buffer[] = [];
	let offset = 0;
	specs.forEach((spec, id) => {
		const base = id * RECORD_SIZE;
		recordBlock.writeUInt32LE(offset, base);
		recordBlock.writeUInt32LE(spec.payload.length, base + 4);
		payloads.push(spec.payload);
		offset += spec.payload.length;
	});
	const header = Buffer.alloc(2);
	const indexOffset = options?.indexOffset ?? 0x10;
	header.writeUInt8(indexOffset, 0);
	header.writeUInt8(key, 1);
	const filler = Buffer.alloc(indexOffset - header.length);
	const descriptor = Buffer.alloc(INDEX_DESCRIPTOR_SIZE);
	descriptor.writeUInt16LE(count, 0);
	// Records hold absolute offsets, so the payload area follows the whole index.
	const dataStart = indexOffset + INDEX_DESCRIPTOR_SIZE + count * RECORD_SIZE;
	for (let id = 0; id < count; id += 1) {
		const base = id * RECORD_SIZE;
		recordBlock.writeUInt32LE(
			options?.zeroOffset && id === 0
				? 0
				: recordBlock.readUInt32LE(base) + dataStart,
			base,
		);
	}
	const index = Buffer.from(recordBlock);
	for (let position = 0; position < index.length; position += 1)
		index[position] =
			((index[position] ?? 0) + byteMask(scheme, position, key)) & 0xff;
	return Buffer.concat([header, filler, descriptor, index, ...payloads]);
}

describe("KAAS engine PD archive", () => {
	it("reads a discovery scheme index", async () => {
		const first = Buffer.from("first pd payload");
		const second = Buffer.from("second pd payload");
		await expectArchive({
			format: kaasPdFormat,
			sourcePath: "graph.pd",
			archive: buildPd([{ payload: first }, { payload: second }]),
			entries: [
				{ path: "graph#0000", size: first.length, content: first },
				{ path: "graph#0001", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("reads an old scheme index", async () => {
		const payload = Buffer.from("legacy pd payload");
		await expectArchive({
			format: kaasPdFormat,
			sourcePath: "graph.pd",
			archive: buildPd([{ payload }], { scheme: "old", key: 0x21 }),
			entries: [{ path: "graph#0000", size: payload.length, content: payload }],
		});
	});

	it("skips records without a payload", async () => {
		const third = Buffer.from("third record");
		const file = buildPd([
			{ payload: Buffer.alloc(0) },
			{ payload: Buffer.alloc(0) },
			{ payload: third },
		]);
		const archive = await kaasPdFormat.open(
			new BufferByteSource(file),
			"graph.pd",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"graph#0002",
			]);
		} finally {
			await archive.close();
		}
	});

	it("types entries as images", async () => {
		const payload = Buffer.from("pd payload");
		const file = buildPd([{ payload }]);
		const archive = await kaasPdFormat.open(
			new BufferByteSource(file),
			"graph.pd",
		);
		try {
			expect(archive.entries[0]?.metadata?.type).toBe("image");
		} finally {
			await archive.close();
		}
	});

	it("rejects an index offset inside the header", async () => {
		const file = buildPd([{ payload: Buffer.from("x") }], { indexOffset: 2 });
		expect(await kaasPdFormat.detect(new BufferByteSource(file), "a.pd")).toBe(
			false,
		);
	});

	it("rejects an index offset past the end of file", async () => {
		const file = buildPd([{ payload: Buffer.from("x") }]);
		file.writeUInt8(0xff, 0);
		expect(await kaasPdFormat.detect(new BufferByteSource(file), "a.pd")).toBe(
			false,
		);
	});

	it("rejects an empty index", async () => {
		const file = buildPd([]);
		expect(await kaasPdFormat.detect(new BufferByteSource(file), "a.pd")).toBe(
			false,
		);
	});

	it("rejects a truncated index", async () => {
		const file = buildPd([
			{ payload: Buffer.from("x") },
			{ payload: Buffer.from("y") },
		]);
		expect(
			await kaasPdFormat.detect(
				new BufferByteSource(
					file.subarray(0, 0x10 + INDEX_DESCRIPTOR_SIZE + 8),
				),
				"a.pd",
			),
		).toBe(false);
	});

	it("rejects an offset before the payload area", async () => {
		const file = buildPd([{ payload: Buffer.from("x") }], { zeroOffset: true });
		expect(await kaasPdFormat.detect(new BufferByteSource(file), "a.pd")).toBe(
			false,
		);
	});

	it("rejects a wrong key", async () => {
		const payload = Buffer.from("pd payload");
		const file = buildPd([{ payload }]);
		file.writeUInt8(0x00, 1);
		expect(await kaasPdFormat.detect(new BufferByteSource(file), "a.pd")).toBe(
			false,
		);
	});
});
