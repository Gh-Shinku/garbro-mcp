import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { kogadoArcFormat } from "../../packages/formats/src/kogado/arc.js";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

interface FixtureEntry {
	/** Offset relative to the archive base offset. */
	offset: number;
	storedSize: number;
	unpackedSize: number;
}

function xorFf(data: Buffer): Buffer {
	const output = Buffer.from(data);
	for (let index = 0; index < output.length; index += 1)
		output[index] = (output[index] ?? 0) ^ 0xff;
	return output;
}

/** Builds one index chunk: a header plus an XOR 0xFF masked literal LZSS stream. */
function chunk(payload: Buffer, type = 0): Buffer {
	const compressed = xorFf(literalLzssStream(payload));
	const header = Buffer.alloc(0x0c);
	header.writeInt32LE(0x0c + compressed.length, 0);
	header.writeInt32LE(type, 4);
	header.writeInt32LE(payload.length, 8);
	return Buffer.concat([header, compressed]);
}

/** Builds a name table of NUL terminated UTF-16LE names and the byte offset of every name. */
function nameTable(names: string[]): { blob: Buffer; offsets: number[] } {
	const parts: Buffer[] = [];
	const offsets: number[] = [];
	let offset = 0;
	for (const name of names) {
		const encoded = Buffer.from(name, "utf16le");
		offsets.push(offset);
		parts.push(encoded, Buffer.from([0, 0]));
		offset += encoded.length + 2;
	}
	return { blob: Buffer.concat(parts), offsets };
}

/** `sectionOf` takes the byte offsets from `nameTable`, which is what the index stores. */
function sectionOf(kind: string, nameOffsets: number[], body: Buffer): Buffer {
	const header = Buffer.alloc(0x10);
	header.write(kind, 0, 4, "latin1");
	header.writeInt32LE(nameOffsets.length, 8);
	header.writeInt32LE(nameOffsets.length * 4 + body.length, 0xc);
	const names = Buffer.alloc(nameOffsets.length * 4);
	for (const [index, value] of nameOffsets.entries())
		names.writeInt32LE(value, index * 4);
	return Buffer.concat([header, names, body]);
}

function plainLayout(entries: FixtureEntry[]): Buffer {
	const body = Buffer.alloc(entries.length * 0x10);
	for (const [index, entry] of entries.entries()) {
		body.writeUInt32LE(entry.offset, index * 0x10);
		body.writeUInt32LE(entry.storedSize, index * 0x10 + 4);
		body.writeUInt32LE(0, index * 0x10 + 8);
		body.writeUInt32LE(entry.unpackedSize, index * 0x10 + 0xc);
	}
	return body;
}

function ddsLayout(
	headers: { flags: number; width: number; height: number }[],
	entries: (FixtureEntry & { headerId: number })[],
): Buffer {
	const head = Buffer.alloc(4 + headers.length * 0xc);
	head.writeInt32LE(headers.length, 0);
	for (const [index, header] of headers.entries()) {
		head.writeUInt32LE(header.flags, 4 + index * 0xc);
		head.writeUInt32LE(header.width, 4 + index * 0xc + 4);
		head.writeUInt32LE(header.height, 4 + index * 0xc + 8);
	}
	const body = Buffer.alloc(entries.length * 0x14);
	for (const [index, entry] of entries.entries()) {
		body.writeUInt32LE(entry.offset, index * 0x14);
		body.writeUInt32LE(entry.storedSize, index * 0x14 + 4);
		body.writeUInt32LE(0, index * 0x14 + 8);
		body.writeUInt32LE(entry.unpackedSize, index * 0x14 + 0xc);
		body.writeInt32LE(entry.headerId, index * 0x14 + 0x10);
	}
	return Buffer.concat([head, body]);
}

function ovaLayout(
	headers: Buffer[],
	entries: (FixtureEntry & { headerId: number })[],
): Buffer {
	const head = Buffer.alloc(8);
	head.writeInt32LE(0, 0);
	head.writeInt32LE(headers.length, 4);
	const headerParts: Buffer[] = [];
	for (const header of headers) {
		const prefix = Buffer.alloc(12);
		prefix.writeInt32LE(header.length, 8);
		headerParts.push(prefix, header);
	}
	const body = Buffer.alloc(entries.length * 0xc);
	for (const [index, entry] of entries.entries()) {
		body.writeUInt32LE(entry.offset, index * 0xc);
		body.writeUInt32LE(entry.unpackedSize, index * 0xc + 4);
		body.writeInt32LE(entry.headerId, index * 0xc + 8);
	}
	return Buffer.concat([head, ...headerParts, body]);
}

interface FixtureOptions {
	names?: string[];
	sections?: Buffer[];
	baseOffset?: number;
	payloads?: Buffer[];
	signature?: Buffer;
	/** Zero bytes appended after the payload block. */
	trailer?: number;
}

/** Assembles a Kogado archive: a header, the two index chunks, then the payload block. */
function buildKogado(options: FixtureOptions): Buffer {
	const blob = nameTable(options.names ?? []).blob;
	const count = Buffer.alloc(4);
	count.writeInt32LE(options.sections?.length ?? 0, 0);
	const index = Buffer.concat([count, ...(options.sections ?? [])]);
	const payloads = options.payloads ?? [];
	const header = Buffer.alloc(0x10);
	(options.signature ?? Buffer.from([0xbe, 0xad, 0xbc, 0xa8])).copy(header, 0);
	const filenamesChunk = chunk(blob, 1);
	const indexChunk = chunk(index, 2);
	const naturalBase = 0x10 + filenamesChunk.length + indexChunk.length;
	const baseOffset = options.baseOffset ?? naturalBase;
	header.writeUInt32LE(baseOffset, 0xc);
	const padding =
		baseOffset > naturalBase ? [Buffer.alloc(baseOffset - naturalBase)] : [];
	return Buffer.concat([
		header,
		filenamesChunk,
		indexChunk,
		...padding,
		Buffer.concat(payloads),
		Buffer.alloc(options.trailer ?? 0),
	]);
}

/** Builds the stored payload of an entry: an XOR 0xFF masked LZSS stream. */
function payloadOf(data: Buffer): Buffer {
	return xorFf(literalLzssStream(data));
}

/**
 * Builds an LZSS stream that only uses matches against the zero filled frame, which compresses a run
 * of zero bytes into fewer bytes than the payload itself. Real entries rely on matches in the same
 * way, and the reference's stored size for OVA entries is the *unpacked* payload length.
 */
function zeroMatchStream(length: number): Buffer {
	const parts: Buffer[] = [Buffer.from([0x00])];
	let remaining = length;
	while (remaining > 0) {
		const count = Math.min(18, remaining);
		if (count < 3) throw new Error("count too small for a match");
		const pair = Buffer.alloc(2);
		pair[0] = 0;
		pair[1] = (count - 3) & 0x0f;
		parts.push(pair);
		remaining -= count;
	}
	return Buffer.concat(parts);
}

function sourceOf(archive: Buffer): BufferByteSource {
	return new BufferByteSource(archive);
}

describe("kogado ARC", () => {
	it("registers the ARC signature", () => {
		expect(
			kogadoArcFormat.detection?.signatures?.map((signature) =>
				Buffer.from(signature.bytes).toString("hex"),
			),
		).toEqual(["beadbca8"]);
	});

	it("declines a file with a broken index chunk", async () => {
		const built = buildKogado({});
		built.writeInt32LE(0, 0x10);
		expect(await kogadoArcFormat.detect(sourceOf(built), "sample.arc")).toBe(
			false,
		);
	});

	it("declines an entry that is not placed inside the archive", async () => {
		const { offsets } = nameTable(["a.bin"]);
		const built = buildKogado({
			names: ["a.bin"],
			sections: [
				sectionOf(
					"\0\0\0\0",
					[offsets[0] ?? 0],
					plainLayout([{ offset: 0, storedSize: 0x1000, unpackedSize: 4 }]),
				),
			],
		});
		expect(await kogadoArcFormat.detect(sourceOf(built), "sample.arc")).toBe(
			false,
		);
	});

	it("declines an archive without sections", async () => {
		const built = buildKogado({ sections: [] });
		expect(await kogadoArcFormat.detect(sourceOf(built), "sample.arc")).toBe(
			false,
		);
	});

	it("lists and extracts a plain section entry", async () => {
		const data = Buffer.from("plain payload");
		const { offsets } = nameTable(["data.bin"]);
		const built = buildKogado({
			names: ["data.bin"],
			sections: [
				sectionOf(
					"\0\0\0\0",
					[offsets[0] ?? 0],
					plainLayout([
						{
							offset: 0,
							storedSize: payloadOf(data).length,
							unpackedSize: data.length,
						},
					]),
				),
			],
			payloads: [payloadOf(data)],
		});
		await expectArchive({
			format: kogadoArcFormat,
			archive: built,
			entries: [{ path: "data.bin", size: 13, content: data }],
		});
	});

	it("prepends the ova header to the decoded payload", async () => {
		const header = Buffer.from("OVAHEADER!");
		const payload = Buffer.alloc(33);
		const stored = payload.length;
		const { offsets } = nameTable(["movie.ova"]);
		const built = buildKogado({
			names: ["movie.ova"],
			sections: [
				sectionOf(
					"OVA\0",
					[offsets[0] ?? 0],
					ovaLayout(
						[header],
						[
							{
								offset: 0,
								storedSize: stored,
								unpackedSize: header.length + payload.length,
								headerId: 0,
							},
						],
					),
				),
			],
			payloads: [xorFf(zeroMatchStream(payload.length))],
			// The stored size of an OVA entry is the unpacked payload size, so the entry needs room
			// for the placement check even though the compressed stream is shorter.
			trailer: 8,
		});
		const archive = await kogadoArcFormat.open(sourceOf(built), "sample.arc");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect({
				path: entry.path,
				size: entry.size,
				stored: entry.packedSize,
				sizeKnown: entry.sizeKnown !== false,
			}).toEqual({
				path: "movie.ova",
				size: BigInt(header.length + payload.length),
				stored: BigInt(stored),
				sizeKnown: false,
			});
			// The reference limits the decoded stream to the entry's unpacked size, which for an OVA
			// entry includes the inline header, so the decoded payload is longer than the payload
			// itself. The extra bytes come from the trailing region of the archive.
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.concat([header, Buffer.alloc(header.length + payload.length)]),
			);
		} finally {
			await archive.close();
		}
	});

	it("reads the dds header table", async () => {
		const data = Buffer.from("dds payload");
		const { offsets } = nameTable(["image.dds"]);
		const built = buildKogado({
			names: ["image.dds"],
			sections: [
				sectionOf(
					"DDS\0",
					[offsets[0] ?? 0],
					ddsLayout(
						[{ flags: 0x41, width: 320, height: 240 }],
						[
							{
								offset: 0,
								storedSize: payloadOf(data).length,
								unpackedSize: data.length,
								headerId: 0,
							},
						],
					),
				),
			],
			payloads: [payloadOf(data)],
		});
		const archive = await kogadoArcFormat.open(sourceOf(built), "sample.arc");
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				dds: { flags: 0x41, width: 320, height: 240, bpp: 32 },
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				data,
			);
		} finally {
			await archive.close();
		}
	});

	it("walks consecutive sections of different kinds", async () => {
		const plain = Buffer.from("first");
		const ova = Buffer.alloc(18);
		const header = Buffer.from("HEAD");
		const { offsets } = nameTable(["a.bin", "b.ova"]);
		const built = buildKogado({
			names: ["a.bin", "b.ova"],
			sections: [
				sectionOf(
					"\0\0\0\0",
					[offsets[0] ?? 0],
					plainLayout([
						{
							offset: 0,
							storedSize: payloadOf(plain).length,
							unpackedSize: plain.length,
						},
					]),
				),
				sectionOf(
					"OVA\0",
					[offsets[1] ?? 0],
					ovaLayout(
						[header],
						[
							{
								offset: payloadOf(plain).length,
								storedSize: ova.length,
								unpackedSize: header.length + ova.length,
								headerId: 0,
							},
						],
					),
				),
			],
			payloads: [payloadOf(plain), xorFf(zeroMatchStream(ova.length))],
		});
		const archive = await kogadoArcFormat.open(sourceOf(built), "sample.arc");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"a.bin",
				"b.ova",
			]);
			const second = archive.entries[1];
			if (!second) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(second.id))).toEqual(
				Buffer.concat([header, ova]),
			);
		} finally {
			await archive.close();
		}
	});

	it("decodes utf-16 names that contain a hierarchy", async () => {
		const data = Buffer.from("nested");
		const { offsets } = nameTable(["sub/dir/file.bin"]);
		const built = buildKogado({
			names: ["sub/dir/file.bin"],
			sections: [
				sectionOf(
					"\0\0\0\0",
					[offsets[0] ?? 0],
					plainLayout([
						{
							offset: 0,
							storedSize: payloadOf(data).length,
							unpackedSize: data.length,
						},
					]),
				),
			],
			payloads: [payloadOf(data)],
		});
		await expectArchive({
			format: kogadoArcFormat,
			archive: built,
			entries: [{ path: "sub/dir/file.bin", size: 6, content: data }],
		});
	});

	it("honours the archive base offset", async () => {
		const data = Buffer.from("based");
		const { offsets } = nameTable(["based.bin"]);
		const built = buildKogado({
			names: ["based.bin"],
			sections: [
				sectionOf(
					"\0\0\0\0",
					[offsets[0] ?? 0],
					plainLayout([
						{
							offset: 0,
							storedSize: payloadOf(data).length,
							unpackedSize: data.length,
						},
					]),
				),
			],
			baseOffset: 0x200,
			payloads: [payloadOf(data)],
		});
		const archive = await kogadoArcFormat.open(sourceOf(built), "sample.arc");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				data,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a section with an out of range dds header id", async () => {
		const data = Buffer.from("dds");
		const { offsets } = nameTable(["image.dds"]);
		const built = buildKogado({
			names: ["image.dds"],
			sections: [
				sectionOf(
					"DDS\0",
					[offsets[0] ?? 0],
					ddsLayout(
						[{ flags: 0x41, width: 1, height: 1 }],
						[
							{
								offset: 0,
								storedSize: payloadOf(data).length,
								unpackedSize: data.length,
								headerId: 3,
							},
						],
					),
				),
			],
			payloads: [payloadOf(data)],
		});
		expect(await kogadoArcFormat.detect(sourceOf(built), "sample.arc")).toBe(
			false,
		);
	});

	it("truncates a payload that is not a complete lzss stream", async () => {
		const broken = Buffer.from([0xff, 0x00, 0x01]);
		const { offsets } = nameTable(["broken.bin"]);
		const built = buildKogado({
			names: ["broken.bin"],
			sections: [
				sectionOf(
					"\0\0\0\0",
					[offsets[0] ?? 0],
					plainLayout([
						{ offset: 0, storedSize: broken.length, unpackedSize: 0x40 },
					]),
				),
			],
			payloads: [broken],
		});
		const archive = await kogadoArcFormat.open(sourceOf(built), "sample.arc");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBeLessThan(0x40);
		} finally {
			await archive.close();
		}
	});
});
