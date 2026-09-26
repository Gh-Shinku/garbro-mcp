// The Unity asset archive port, against an archive built in the test: the head of the file, the index of
// it (the streams of the places of the file and the bundles over them) and a serialized asset of the engine
// within a stream (`asset-file.ts`). The asset of the fixture stands of a table of one kind (`TextAsset`)
// of two places, of the name of an object and of the places of a script behind them, so the walk of the
// names of the objects and the places of a script stand pinned. An index standing of the walk of the blocks
// of the format (LZ4) stands beside it.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { unityFsFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	readUnityAsset,
	readUnityObjectTypeName,
} from "../../packages/formats/src/unity/asset-file.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import {
	readUnityFsHead,
	readUnityFsIndex,
	shortenUnityPath,
	unityFsDescriptor,
} from "../../packages/formats/src/unity/unity-fs.js";

function be16(value: number): Buffer {
	const out = Buffer.alloc(2, 0x00);
	out.writeUInt16BE(value & 0xffff, 0);
	return out;
}

function be32(value: number): Buffer {
	const out = Buffer.alloc(4, 0x00);
	out.writeUInt32BE(value >>> 0, 0);
	return out;
}

function be64(value: number): Buffer {
	const out = Buffer.alloc(8, 0x00);
	out.writeBigUInt64BE(BigInt(value), 0);
	return out;
}

function le32(value: number): Buffer {
	const out = Buffer.alloc(4, 0x00);
	out.writeInt32LE(value | 0, 0);
	return out;
}

function le16(value: number): Buffer {
	const out = Buffer.alloc(2, 0x00);
	out.writeInt16LE(value | 0, 0);
	return out;
}

function le64(value: number): Buffer {
	const out = Buffer.alloc(8, 0x00);
	out.writeBigInt64LE(BigInt(value), 0);
	return out;
}

function cstring(value: string): Buffer {
	return Buffer.concat([Buffer.from(value, "utf8"), Buffer.from([0])]);
}

/** A place of the walk of the places of an asset of the older kinds (`TypeTree.LoadRaw`). */
function typeNode(input: {
	type: string;
	name: string;
	size?: number;
	isArray?: boolean;
	flags?: number;
	children?: Buffer[];
}): Buffer {
	const children = input.children ?? [];
	return Buffer.concat([
		cstring(input.type),
		cstring(input.name),
		le32(input.size ?? 0),
		le32(0),
		le32(input.isArray ? 1 : 0),
		le32(1),
		le32(input.flags ?? 0),
		le32(children.length),
		...children,
	]);
}

/** The count of the places of the head of an archive of the engine (the counts of the head of it). */
const HEAD_PLACES = 49;

/** A serialized asset of the engine of the kind eleven, of one `TextAsset` of one script. */
function serializedAsset(script: string): Buffer {
	const name = "sample";
	const tree = typeNode({
		type: "TextAsset",
		name: "Base",
		children: [
			typeNode({ type: "string", name: "m_Name", size: -1 }),
			typeNode({ type: "string", name: "m_Script", size: -1, flags: 0 }),
		],
	});
	return serializedAssetOf(
		tree,
		Buffer.concat([
			le32(name.length),
			Buffer.from(name, "utf8"),
			le32(script.length),
			Buffer.from(script, "latin1"),
		]),
		script.length + 16,
	);
}

/** A serialized asset of the engine of the kind eleven, of one object of the kind the tree names. */
function serializedAssetOf(
	tree: Buffer,
	body: Buffer,
	size = body.length,
): Buffer {
	const head = Buffer.concat([
		le32(0), // the count of the places of the head of the file
		le32(0), // the count of the places of the file
		le32(11),
		le32(0), // the places of the walk of the file, written below
		le32(0), // the kind of the count of the file: little endian
	]);
	const treeData = Buffer.concat([
		cstring("5.x.x"),
		le32(0),
		le32(1),
		le32(49),
		tree,
	]);
	const header = Buffer.concat([
		head,
		treeData,
		le32(1), // the kind of the name of an object: of the count of eight places
	]);
	// The count of the objects of the asset, and then the objects themselves. The places of the walk of a
	// file of this kind stand of no count of four places (that walk stands of the kinds fourteen and up),
	// so the object stands behind the count of it with no place behind it.
	const placed = Buffer.concat([header, le32(1)]);
	// One object: its name, the places of it within the file, and the kind of it.
	const object = Buffer.concat([
		le64(1), // the name of the object
		le32(0), // the places of it within the walk of the file
		le32(size), // the count of the places of it
		le32(49), // the kind of it, of the table of the head
		le16(49),
		le16(0),
	]);
	const tail = Buffer.concat([le32(0), le32(0), cstring("")]);
	const prefix = Buffer.concat([placed, object, tail]);
	const dataOffset = prefix.length;
	const places = Buffer.alloc(prefix.length, 0x00);
	prefix.copy(places);
	places.writeInt32LE(dataOffset, 0x0c);
	return Buffer.concat([places, body]);
}

/**
 * A serialized asset of the engine of the kind eleven, of one object of the kind `Texture2D` of the places
 * the walk of the head of a picture of the engine stands of.
 */
function serializedTexture(picture: {
	name: string;
	width: number;
	height: number;
	format: number;
	data: Buffer;
}): Buffer {
	const tree = typeNode({
		type: "Texture2D",
		name: "Base",
		children: [typeNode({ type: "string", name: "m_Name", size: -1 })],
	});
	const name = Buffer.from(picture.name, "latin1");
	// The walk of the head of a picture stands of no place of filling here: the places of a file of the kind
	// of asset of this fixture stand as they stand.
	return serializedAssetOf(
		tree,
		Buffer.concat([
			le32(name.length),
			name,
			le32(picture.width),
			le32(picture.height),
			le32(picture.data.length), // the count of the places of the picture
			le32(picture.format),
			le32(1), // the count of the walks of the picture
			// The places a file of this kind stands of two flags of its own, of no count of them.
			Buffer.from([0x00, 0x00]),
			le32(1), // the count of the pictures of the object
			le32(2), // the shape of the picture: two places
			le32(0), // the way the places of the picture stand, of no count of them
			le32(1), // the count of the places of the walk of the widths of the picture
			le32(0), // the walk of the places of the picture, of four places of the file
			le32(0), // the way the places of the picture stand beyond the picture
			le32(1), // the places of the picture, of a count of one place
			le32(0), // the places of the picture, of the kinds of the places of it
			le32(picture.data.length),
			picture.data,
		]),
	);
}

/** The places of a run of the places of a block of the format, of no place of a match at all. */
function lz4Literals(places: Buffer): Buffer {
	const parts: Buffer[] = [];
	let at = 0;
	while (at < places.length) {
		const run = Math.min(places.length - at, 0x1000);
		if (run < 0x0f) {
			parts.push(Buffer.from([run << 4]));
		} else {
			const extra: number[] = [];
			let left = run - 0x0f;
			while (left >= 0xff) {
				extra.push(0xff);
				left -= 0xff;
			}
			extra.push(left);
			parts.push(Buffer.from([0xf0, ...extra]));
		}
		parts.push(places.subarray(at, at + run));
		at += run;
	}
	return Buffer.concat(parts);
}

/** An archive of the engine: the head of it, the index of it and the streams of it. */
function unityFsFile(input: {
	asset: Buffer;
	compressIndex?: boolean;
	fileName?: string;
}): Buffer {
	const index = Buffer.concat([
		Buffer.alloc(16, 0x00),
		be32(1),
		be32(input.asset.length),
		be32(input.asset.length),
		be16(0), // the stream of the places of the asset stands as it stands
		be32(1),
		be64(0),
		be64(input.asset.length),
		be32(0),
		cstring(input.fileName ?? "CAB-sample"),
	]);
	const packed = input.compressIndex ? lz4Literals(index) : index;
	const head = Buffer.concat([
		Buffer.from("UnityFS\0", "latin1"),
		be32(6),
		cstring("5.x.x"),
		cstring("2019.4.1f1"),
		be64(HEAD_PLACES + packed.length + input.asset.length),
		be32(packed.length),
		be32(index.length),
		be32(input.compressIndex ? 2 : 0),
	]);
	return Buffer.concat([head, packed, input.asset]);
}

async function archiveOf(data: Buffer) {
	const source = new BufferByteSource(data);
	expect(await unityFsFormat.detect(source, "sample.unity3d")).toBe(true);
	return unityFsFormat.open(source, "sample.unity3d");
}

/** The places of a picture of this project, of the places a walk of the engine stands of. */
function readPicture(places: Buffer) {
	const picture = readBmpImage(places);
	if (!picture) throw new Error("the walk stood of no picture");
	return picture;
}

describe("Unity asset archive", () => {
	it("reads the head of the file and the table of the streams of it", () => {
		const asset = serializedAsset("hello script");
		const data = unityFsFile({ asset });
		const head = readUnityFsHead(data);
		if (!head) throw new Error("no head of the archive");
		expect(head.engineVersion).toBe("5.x.x");
		expect(head.revision).toBe("2019.4.1f1");
		expect(head.indexOffset).toBe(HEAD_PLACES);
		expect(head.dataOffset).toBe(head.indexOffset + head.packedIndexSize);
		const index = readUnityFsIndex(
			data.subarray(head.indexOffset, head.dataOffset),
			head.dataOffset,
		);
		if (!index) throw new Error("no index of the archive");
		expect(index.segments.length).toBe(1);
		expect(index.segments[0]?.unpackedSize).toBe(asset.length);
		expect(index.bundles).toEqual([
			{ offset: 0, size: asset.length, flags: 0, name: "CAB-sample" },
		]);
	});

	it("reads the serialized asset of a bundle of the file", () => {
		const asset = serializedAsset("hello script");
		const parsed = readUnityAsset(asset);
		if (!parsed) throw new Error("no walk of the asset");
		expect(parsed.format).toBe(11);
		expect(parsed.isLittleEndian).toBe(true);
		expect(parsed.tree.version).toBe("5.x.x");
		expect(parsed.objects.length).toBe(1);
		const object = parsed.objects[0];
		if (!object) throw new Error("no object of the asset");
		expect(object.pathId).toBe(1);
		expect(object.size).toBe("hello script".length + 16);
		expect(readUnityObjectTypeName(parsed, object)).toBe("TextAsset");
	});

	it("lists and hands over the objects of the bundles of the file", async () => {
		const asset = serializedAsset("hello script");
		const archive = await archiveOf(unityFsFile({ asset }));
		try {
			expect(archive.metadata).toMatchObject({
				unityVersion: "5.x.x",
				segments: 1,
				bundles: 1,
			});
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"sample.text",
			]);
			const entry = archive.entries[0];
			if (!entry) throw new Error("no entry");
			expect(entry.metadata).toMatchObject({
				type: "script",
				unityType: "TextAsset",
				kind: "text",
			});
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.from("hello script", "latin1"),
			);
		} finally {
			await archive.close();
		}
	});

	it("reads an index standing of the walk of the blocks of the format", async () => {
		const asset = serializedAsset("packed index");
		const archive = await archiveOf(
			unityFsFile({ asset, compressIndex: true }),
		);
		try {
			expect(archive.entries.length).toBe(1);
			const entry = archive.entries[0];
			if (!entry) throw new Error("no entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.from("packed index", "latin1"),
			);
		} finally {
			await archive.close();
		}
	});

	it("reads a picture of an object of the kind Texture2D", async () => {
		// The places of a picture of the kind `RGBA32` stand red, green, blue then the covering place, and
		// the rows of a picture of the engine stand from its foot up.
		const data = Buffer.from([
			10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
		]);
		const asset = serializedTexture({
			name: "sample",
			width: 2,
			height: 2,
			format: 4,
			data,
		});
		const archive = await archiveOf(unityFsFile({ asset }));
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"sample.bmp",
			]);
			const entry = archive.entries[0];
			if (!entry) throw new Error("no entry");
			expect(entry.metadata).toMatchObject({
				type: "image",
				unityType: "Texture2D",
				kind: "image",
			});
			const picture = readPicture(
				await consumeBuffer(await archive.openEntry(entry.id)),
			);
			expect([picture.width, picture.height, picture.bitsPerPixel]).toEqual([
				2, 2, 32,
			]);
			expect([...picture.pixels]).toEqual([
				90, 80, 70, 255, 120, 110, 100, 255, 30, 20, 10, 255, 60, 50, 40, 255,
			]);
		} finally {
			await archive.close();
		}
	});

	it("reads a picture of the kind whose places stand as they stand", async () => {
		const data = Buffer.from([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
		]);
		const asset = serializedTexture({
			name: "plain",
			width: 2,
			height: 2,
			format: 14, // the places of the picture stand blue, green, red then the covering place
			data,
		});
		const archive = await archiveOf(unityFsFile({ asset }));
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("no entry");
			const picture = readPicture(
				await consumeBuffer(await archive.openEntry(entry.id)),
			);
			expect([...picture.pixels]).toEqual([
				9, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4, 5, 6, 7, 8,
			]);
		} finally {
			await archive.close();
		}
	});

	it("reads a picture standing of the blocks of the kind DXT1", async () => {
		// Two rows of blocks: the one of the file stands white, and the one behind it black, while the
		// rows of a picture of the engine stand from its foot up.
		const white = Buffer.from([0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
		const black = Buffer.from([0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00]);
		const asset = serializedTexture({
			name: "blocks",
			width: 4,
			height: 8,
			format: 10,
			data: Buffer.concat([white, black]),
		});
		const archive = await archiveOf(unityFsFile({ asset }));
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("no entry");
			const picture = readPicture(
				await consumeBuffer(await archive.openEntry(entry.id)),
			);
			expect([picture.width, picture.height, picture.bitsPerPixel]).toEqual([
				4, 8, 32,
			]);
			const rows: number[][] = [];
			for (let row = 0; row < 8; row += 1) {
				rows.push([...picture.pixels.subarray(row * 16, row * 16 + 16)]);
			}
			const blackRow = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];
			const whiteRow = Array(16).fill(0xff);
			for (let row = 0; row < 4; row += 1) {
				expect(rows[row]).toEqual(blackRow);
				expect(rows[row + 4]).toEqual(whiteRow);
			}
		} finally {
			await archive.close();
		}
	});

	it("turns away a picture of a kind this project does not read", async () => {
		const asset = serializedTexture({
			name: "other",
			width: 2,
			height: 2,
			format: 25, // the kind of the places of a picture of seven places
			data: Buffer.alloc(16, 0x00),
		});
		const archive = await archiveOf(unityFsFile({ asset }));
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

	it("turns away a word of another kind and a file that stands short", async () => {
		const asset = serializedAsset("hello script");
		const data = unityFsFile({ asset });
		const other = Buffer.from(data);
		other.write("UnityFX", 0, "latin1");
		expect(
			await unityFsFormat.detect(new BufferByteSource(other), "other.unity3d"),
		).toBe(false);
		// A file of the word of the format of a count of the head of its own stands no archive of this
		// engine, and neither does a file of no head of an index to walk.
		const short = Buffer.from(data.subarray(0, 12));
		expect(
			await unityFsFormat.detect(new BufferByteSource(short), "short.unity3d"),
		).toBe(false);
		const noIndex = Buffer.concat([data.subarray(0, HEAD_PLACES)]);
		// The head of the file names no places of an index at all, so the walk of it stands of no place to
		// read behind them.
		noIndex.writeUInt32BE(0, HEAD_PLACES - 12);
		expect(
			await unityFsFormat.detect(new BufferByteSource(noIndex), "no.unity3d"),
		).toBe(true);
		await expect(
			unityFsFormat.open(new BufferByteSource(noIndex), "no.unity3d"),
		).rejects.toThrow(GarbroError);
		expect(unityFsDescriptor.id).toBe("unity-unityfs-archive");
		expect(shortenUnityPath("assets/foo/bar/prefab")).toBe("bar/prefab");
	});
});
