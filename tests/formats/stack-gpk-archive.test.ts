// The Stack script engine resource archive (GARbro "ArcFormats/Stack/ArcGPK.cs", class GpkOpener), against
// archives and executables built in the test. The index of the archive stands at its end, exclusive-ored
// with a cipher the engine keeps in the resource `CODE` of the kind `CIPHERCODE` of a neighbouring
// executable.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { stackGpkFormat } from "@garbro-mcp/formats";
import { stackGpkDescriptor } from "../../packages/formats/src/stack/gpk-archive.js";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { withCompanionFiles } from "../helpers/companion.js";

const INDEX_MARK = "STKFile0PIDX";
const PACK_MARK = "STKFile0PACKFILE";

function le16(value: number): Buffer {
	const out = Buffer.alloc(2);
	out.writeUInt16LE(value, 0);
	return out;
}

function le32(value: number): Buffer {
	const out = Buffer.alloc(4);
	out.writeUInt32LE(value >>> 0, 0);
	return out;
}

/** The cipher of the index as a mirror of the walk of the port: the places of the file exclusive-ored. */
function xorPlaces(data: Buffer, key: Buffer): Buffer {
	const out = Buffer.from(data);
	for (let at = 0; at < out.length; at += 1) {
		out[at] = (out[at] ?? 0) ^ (key[at % key.length] ?? 0);
	}
	return out;
}

/**
 * A minimal 32 bit image with one `.rsrc` section that carries the cipher as the resource of the kind
 * `CIPHERCODE` named `CODE`, of the language 0x409. The resource tree stands three levels down, each level a
 * directory of entries; both the kind and the name stand of a name rather than of a number here, so the two
 * upper levels stand of a name of their own.
 */
function executableWithCipher(cipher: Buffer): Buffer {
	/** A name of the tree of the resources, of the count of its places and then the places themselves. */
	const name = (text: string): Buffer => {
		const out = Buffer.alloc(2 + text.length * 2);
		out.writeUInt16LE(text.length, 0);
		out.write(text, 2, "utf16le");
		return out;
	};
	const kind = name("CIPHERCODE");
	const resource = name("CODE");
	const kindAt = 0x70;
	const resourceAt = kindAt + kind.length;
	const dataAt = resourceAt + resource.length;
	const tree = Buffer.alloc(dataAt + cipher.length);
	tree.writeUInt16LE(1, 0x0c); // the root stands of one entry of a name
	tree.writeUInt16LE(0, 0x0e);
	tree.writeUInt32LE((0x80000000 | kindAt) >>> 0, 0x10);
	tree.writeUInt32LE((0x80000000 | 0x20) >>> 0, 0x14);
	tree.writeUInt16LE(1, 0x20 + 0x0c); // the kind stands of one entry of a name
	tree.writeUInt16LE(0, 0x20 + 0x0e);
	tree.writeUInt32LE((0x80000000 | resourceAt) >>> 0, 0x30);
	tree.writeUInt32LE((0x80000000 | 0x40) >>> 0, 0x34);
	tree.writeUInt16LE(0, 0x40 + 0x0c); // the name stands of one entry of a number
	tree.writeUInt16LE(1, 0x40 + 0x0e);
	tree.writeUInt32LE(0x409, 0x50);
	tree.writeUInt32LE(0x60, 0x54);
	tree.writeUInt32LE(0x1000 + dataAt, 0x60);
	tree.writeUInt32LE(cipher.length, 0x64);
	kind.copy(tree, kindAt);
	resource.copy(tree, resourceAt);
	cipher.copy(tree, dataAt);

	const headers = Buffer.alloc(0x200);
	headers.write("MZ", 0, "ascii");
	headers.writeUInt32LE(0x40, 0x3c);
	headers.write("PE\0\0", 0x40, "binary");
	headers.writeUInt16LE(1, 0x40 + 6);
	headers.writeUInt16LE(0xe0, 0x40 + 0x14);
	const optional = 0x40 + 0x18;
	headers.writeUInt16LE(0x010b, optional);
	headers.writeUInt32LE(0x200, optional + 0x3c);
	headers.writeUInt32LE(0x1000, optional + 0x60 + 0x10);
	headers.writeUInt32LE(tree.length, optional + 0x60 + 0x14);
	const section = optional + 0xe0;
	headers.write(".rsrc", section, "latin1");
	headers.writeUInt32LE(tree.length, section + 8);
	headers.writeUInt32LE(0x1000, section + 0x0c);
	headers.writeUInt32LE(0x200, section + 0x14);
	return Buffer.concat([headers, tree]);
}

interface GpkRecordInput {
	name: string;
	data: Buffer;
	unpacked?: number;
	header?: Buffer;
}

/** An archive of the engine: the places of the pictures and scripts of it, and the index behind them. */
function gpkFile(records: GpkRecordInput[], key: Buffer): Buffer {
	const parts: Buffer[] = [];
	let offset = 0;
	const indexParts: Buffer[] = [];
	for (const record of records) {
		parts.push(record.data);
		const name = Buffer.from(record.name, "utf16le");
		indexParts.push(
			le16(record.name.length),
			name,
			le32(0),
			le16(0),
			le32(offset),
			le32(record.data.length),
			le32(0),
			le32(record.unpacked ?? 0),
			Buffer.from([record.header?.length ?? 0]),
			record.header ?? Buffer.alloc(0),
		);
		offset += record.data.length;
	}
	indexParts.push(le16(0));
	const body = Buffer.concat([
		Buffer.alloc(4, 0x00),
		deflateSync(Buffer.concat(indexParts)),
	]);
	const index = xorPlaces(body, key);
	const foot = Buffer.alloc(32, 0x00);
	foot.write(INDEX_MARK, 0, "latin1");
	foot.writeUInt32LE(index.length, 12);
	foot.write(PACK_MARK, 16, "latin1");
	return Buffer.concat([...parts, index, foot]);
}

describe("Stack script engine resource archive", () => {
	it("reads the index at the end of the file and the pictures behind it", async () => {
		const key = Buffer.from("0123456789abcdef", "latin1");
		const plain = Buffer.from([1, 2, 3, 4, 5, 6]);
		const packed = deflateSync(Buffer.from("a script of the engine\n", "utf8"));
		const file = gpkFile(
			[
				{
					name: "picture.bmp",
					data: plain,
					header: Buffer.from("BM", "latin1"),
				},
				{ name: "script.txt", data: packed, unpacked: 22 },
			],
			key,
		);
		await withCompanionFiles(
			"game.gpk",
			{ "game.gpk": file, "game.exe": executableWithCipher(key) },
			async (mainPath) => {
				const source = new BufferByteSource(file);
				expect(await stackGpkFormat.detect(source, mainPath)).toBe(true);
				const archive = await stackGpkFormat.open(source, mainPath);
				try {
					expect(archive.entries.map((entry) => entry.path)).toEqual([
						"picture.bmp",
						"script.txt",
					]);
					const [picture, script] = archive.entries;
					if (!picture || !script) throw new Error("no entries");
					expect(Number(picture.size)).toBe(6);
					expect(picture.compressed).toBe(false);
					expect(Number(script.size)).toBe(packed.length);
					expect(script.compressed).toBe(true);
					expect(script.metadata).toMatchObject({
						unpackedSize: 22,
						packed: true,
					});
					// The head of a picture of the engine stands in front of its places, and the reference
					// walks the places of the file over the whole of the two.
					expect(
						await consumeBuffer(await archive.openEntry(picture.id)),
					).toEqual(Buffer.concat([Buffer.from("BM", "latin1"), plain]));
					expect(
						await consumeBuffer(await archive.openEntry(script.id)),
					).toEqual(Buffer.from("a script of the engine\n", "utf8"));
				} finally {
					await archive.close();
				}
			},
		);
	});

	it("reads the cipher of the index out of the resource of an executable", async () => {
		// The resource stands of twenty places, of which the reference takes the sixteen behind the first
		// four; the whole of a resource of any other count stands as the cipher.
		const full = executableWithCipher(
			Buffer.from("0123456789abcdef", "latin1"),
		);
		const twenty = executableWithCipher(
			Buffer.concat([
				Buffer.from("head", "latin1"),
				Buffer.from("0123456789abcdef", "latin1"),
			]),
		);
		const file = Buffer.concat([
			Buffer.alloc(0x40, 0x00),
			Buffer.alloc(32, 0x00),
		]);
		await withCompanionFiles(
			"game.gpk",
			{ "game.gpk": file, "game.exe": full },
			async (mainPath) => {
				const { findGpkKey } = await import(
					"../../packages/formats/src/stack/gpk-archive.js"
				);
				expect((await findGpkKey(mainPath))?.toString("latin1")).toBe(
					"0123456789abcdef",
				);
			},
		);
		await withCompanionFiles(
			"game.gpk",
			{ "game.gpk": file, "game.exe": twenty },
			async (mainPath) => {
				const { findGpkKey } = await import(
					"../../packages/formats/src/stack/gpk-archive.js"
				);
				expect((await findGpkKey(mainPath))?.toString("latin1")).toBe(
					"0123456789abcdef",
				);
			},
		);
	});

	it("stands of no file of another mark, of no cipher at all or of places beyond it", async () => {
		const key = Buffer.from("0123456789abcdef", "latin1");
		const good = gpkFile([{ name: "a.bin", data: Buffer.alloc(4, 0x11) }], key);
		// A file whose word at the foot of it stands of another name.
		const otherMark = Buffer.from(good);
		otherMark[otherMark.length - 32] = 0x58;
		// A file whose index stands of no walk of the places of the file at all.
		const otherIndex = Buffer.from(good);
		otherIndex[otherIndex.length - 32 + 4] = 0x00;
		for (const [what, file] of [
			["another word at the foot", otherMark],
			["no walk of the places of the index", otherIndex],
		] as [string, Buffer][]) {
			await withCompanionFiles(
				"game.gpk",
				{ "game.gpk": file, "game.exe": executableWithCipher(key) },
				async (mainPath) => {
					const source = new BufferByteSource(file);
					expect(await stackGpkFormat.detect(source, mainPath), what).toBe(
						false,
					);
				},
			);
		}
		// A file of no executable beside it stands of no cipher, and so of no archive.
		await withCompanionFiles(
			"game.gpk",
			{ "game.gpk": good },
			async (mainPath) => {
				const source = new BufferByteSource(good);
				expect(await stackGpkFormat.detect(source, mainPath)).toBe(false);
				await expect(
					stackGpkFormat.open(source, mainPath),
				).rejects.toMatchObject({
					code: "INVALID_ARCHIVE",
				});
			},
		);
	});

	it("names itself as the walk of the places of the archive of the engine", () => {
		expect(stackGpkDescriptor.id).toBe("stack-gpk-archive");
		expect(stackGpkFormat.descriptor.extensions).toEqual([]);
	});
});
