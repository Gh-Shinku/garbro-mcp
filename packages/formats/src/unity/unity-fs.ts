// The asset archive of the Unity engine (`UnityFS`), of the reference `ArcFormats/Unity/ArcUnityFS.cs`
// (`UnityFSOpener`, `BundleSegment`, `BundleEntry`, `AssetEntry`, `AssetDeserializer`) over the walks of
// `ArcFormats/Unity/BundleStream.cs` and `ArcFormats/Unity/Asset.cs`.
//
// The file stands of a head (the counts of the file, the counts of the index of it and the kind of the
// walk of each of them), of the index of it (the counts of the places of the streams of the file and the
// names of the bundles of it) and of the streams themselves. Every stream of the file stands of the places
// of the file of it as they stand or of a walk of their own (the walk of the places of a block of the
// format, which stands in this project as `codecs/lz4.ts`); the walk of a stream of the LZMA kind stands of
// a codec this project holds no walk of, and stands refused.
//
// Every bundle of the archive stands of a serialized asset of the engine (`asset-file.ts`), of the places
// of a stream of the file of the archive: the objects of it stand of the places of the stream, of the names
// the table of the asset stands of them. The reference reads the places of an object of the kind
// `Texture2D` and of the kind `AudioClip` of a walk of its own; this port stands of the places of the
// objects themselves and refuses those two kinds where their places are asked for.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { decompressLz4Block } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import {
	type UnityAssetFile,
	type UnityObjectHead,
	UnityReader,
	readUnityAsset,
	readUnityObjectType,
	readUnityObjectTypeName,
} from "./asset-file.js";

const MARK = Buffer.from("UnityFS\0", "latin1");
const VERSION = 6;
const HEAD_SIZE = 0xc;
const VERSION_FIELD = 0x08;
const INDEX_KIND_MASK = 0x3f;
const INDEX_AT_END = 0x80;
const INDEX_SKIP = 16;
const KIND_STORED = 0;
const KIND_LZMA = 1;
const KIND_LZ4 = 2;
const KIND_LZ4_HIGH = 3;
const BUNDLE_UNREAD_KINDS = [".resource", ".ress"];
const SCRIPT_CLASS_FLAG = 0x04000000;
const IMAGE_SIGNATURE = 0x0d15f641;
const PNG_SIGNATURE = 0x474e5089;
const TEXT_ENCODING = "utf8";
const PATH_SEPARATOR = "/";

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupportedArchive(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

/** The head of an archive of the engine, of the places of the index of it. */
export interface UnityFsHead {
	engineVersion: string;
	revision: string;
	fileSize: number;
	packedIndexSize: number;
	indexSize: number;
	flags: number;
	indexOffset: number;
	dataOffset: number;
}

/** `UnityFSOpener.TryOpen`: the head of the file, of the places of it. */
export function readUnityFsHead(data: Buffer): UnityFsHead | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (
		data.subarray(0, MARK.length).toString("latin1") !== MARK.toString("latin1")
	) {
		return undefined;
	}
	if (VERSION !== data.readInt32BE(VERSION_FIELD)) return undefined;
	let at = HEAD_SIZE;
	const readCString = (): string => {
		const end = data.indexOf(0, at);
		const stop = -1 === end ? data.length : end;
		const value = data.toString(TEXT_ENCODING, at, stop);
		at = -1 === end ? data.length : end + 1;
		return value;
	};
	const engineVersion = readCString();
	const revision = readCString();
	if (at + 20 > data.length) return undefined;
	const fileSize = Number(data.readBigInt64BE(at));
	at += 8;
	const packedIndexSize = data.readInt32BE(at);
	at += 4;
	const indexSize = data.readInt32BE(at);
	at += 4;
	const flags = data.readInt32BE(at);
	at += 4;
	if (packedIndexSize < 0 || indexSize < 0) return undefined;
	let indexOffset = at;
	let dataOffset = at + packedIndexSize;
	if (0 !== (flags & INDEX_AT_END)) {
		indexOffset = fileSize - packedIndexSize;
		dataOffset = at;
	}
	if (indexOffset < 0 || indexOffset + packedIndexSize > data.length) {
		return undefined;
	}
	return {
		engineVersion,
		revision,
		fileSize,
		packedIndexSize,
		indexSize,
		flags,
		indexOffset,
		dataOffset,
	};
}

/** A stream of the places of an archive of the engine. */
export interface UnityBundleSegment {
	offset: number;
	packedSize: number;
	unpackedOffset: number;
	unpackedSize: number;
	compression: number;
}

/** A bundle of an archive of the engine: the places of it within the streams of the file. */
export interface UnityBundleEntry {
	offset: number;
	size: number;
	flags: number;
	name: string;
}

/** `AssetDeserializer.Parse`: the streams of the file and the bundles over them. */
export function readUnityFsIndex(
	index: Buffer,
	dataOffset: number,
): { segments: UnityBundleSegment[]; bundles: UnityBundleEntry[] } | undefined {
	if (index.length < INDEX_SKIP + 4) return undefined;
	let at = INDEX_SKIP;
	const segmentCount = index.readInt32BE(at);
	at += 4;
	if (segmentCount < 0 || segmentCount > 0x10000) return undefined;
	const segments: UnityBundleSegment[] = [];
	let packedOffset = dataOffset;
	let unpackedOffset = 0;
	for (let place = 0; place < segmentCount; place += 1) {
		if (at + 10 > index.length) return undefined;
		const unpackedSize = index.readUInt32BE(at);
		const packedSize = index.readUInt32BE(at + 4);
		const compression = index.readUInt16BE(at + 8);
		at += 10;
		segments.push({
			offset: packedOffset,
			packedSize,
			unpackedOffset,
			unpackedSize,
			compression,
		});
		packedOffset += packedSize;
		unpackedOffset += unpackedSize;
	}
	if (at + 4 > index.length) return undefined;
	const count = index.readInt32BE(at);
	at += 4;
	if (count < 0 || count > 0x100000) return undefined;
	const bundles: UnityBundleEntry[] = [];
	for (let place = 0; place < count; place += 1) {
		if (at + 20 > index.length) return undefined;
		const offset = Number(index.readBigInt64BE(at));
		const size = Number(index.readBigInt64BE(at + 8));
		const flags = index.readUInt32BE(at + 16);
		at += 20;
		const end = index.indexOf(0, at);
		const stop = -1 === end ? index.length : end;
		const name = index.toString(TEXT_ENCODING, at, stop);
		at = -1 === end ? index.length : end + 1;
		bundles.push({ offset, size, flags, name });
	}
	return { segments, bundles };
}

/** The index of the file, of the walk of the places of it and of the walk of the kind of it. */
export function readUnityFsIndexData(
	data: Buffer,
	head: UnityFsHead,
): Buffer | undefined {
	const packed = data.subarray(
		head.indexOffset,
		head.indexOffset + head.packedIndexSize,
	);
	const kind = head.flags & INDEX_KIND_MASK;
	if (KIND_STORED === kind) return packed;
	if (KIND_LZMA === kind) {
		throw unsupportedArchive(
			"The index of the archive stands of the LZMA walk",
		);
	}
	if (KIND_LZ4 === kind || KIND_LZ4_HIGH === kind) {
		return decompressLz4Block(packed, head.indexSize);
	}
	return undefined;
}

/** `BundleStream`: the places of the streams of the file, one behind the other. */
export function unpackUnityFsSegments(
	data: Buffer,
	segments: readonly UnityBundleSegment[],
): Buffer {
	const parts: Buffer[] = [];
	for (const segment of segments) {
		const packed = data.subarray(
			segment.offset,
			segment.offset + segment.packedSize,
		);
		if (packed.length !== segment.packedSize) {
			throw invalidArchive(
				"The places of a stream of the file stand short of it",
			);
		}
		const kind = segment.compression & INDEX_KIND_MASK;
		if (KIND_STORED === kind) {
			parts.push(Buffer.from(packed));
			continue;
		}
		if (KIND_LZMA === kind) {
			throw unsupportedArchive("A stream of the file stands of the LZMA walk");
		}
		if (KIND_LZ4 === kind || KIND_LZ4_HIGH === kind) {
			parts.push(decompressLz4Block(packed, segment.unpackedSize));
			continue;
		}
		throw unsupportedArchive(
			`A stream of the file stands of the walk ${kind} of no name`,
		);
	}
	return Buffer.concat(parts);
}

/** `UnityFSOpener.DecryptAsset`: the places of a sound of the engine, of the count of it. */
export function decryptUnityAsset(data: Buffer): Buffer {
	const out = Buffer.from(data);
	let key = 0xbf8766f5;
	for (let at = 0; at < out.length; at += 1) {
		key = (Math.imul(0x343fd, key) + 0x269ec3) >>> 0;
		const place = (key >>> 16) & 0x7fff;
		out[at] = (out[at] ?? 0) ^ (place & 0xff);
	}
	return out;
}

/** The place of a name of an object of an asset, of the walk of the head of it. */
function readUnityObjectName(
	objectData: Buffer,
	asset: UnityAssetFile,
	object: UnityObjectHead,
): string {
	const type = readUnityObjectType(asset, object);
	const first = type?.children[0];
	if ("m_Name" !== first?.name || "string" !== first.type) {
		return object.pathId.toString(16).toUpperCase().padStart(16, "0");
	}
	const reader = new UnityReader(objectData.subarray(object.offset));
	reader.setup(asset.format, asset.isLittleEndian);
	try {
		const name = reader.readString();
		return name.length > 0
			? name
			: object.pathId.toString(16).toUpperCase().padStart(16, "0");
	} catch {
		return object.pathId.toString(16).toUpperCase().padStart(16, "0");
	}
}

/** `AssetDeserializer.ShortenPath`: the last places of a place of the table of the bundles of an asset. */
export function shortenUnityPath(name: string): string {
	const last = name.lastIndexOf(PATH_SEPARATOR);
	if (-1 === last) return name;
	const before = name.lastIndexOf(PATH_SEPARATOR, last - 1);
	if (-1 === before) return name;
	return name.slice(before + 1);
}

/**
 * `AssetDeserializer.ReadAssetBundle`: the names of the objects of an asset, of the table of the places of
 * the bundle of it.
 */
export function readUnityAssetBundleNames(
	objectData: Buffer,
	asset: UnityAssetFile,
	object: UnityObjectHead,
): Map<number, string> | undefined {
	const reader = new UnityReader(objectData.subarray(object.offset));
	reader.setup(asset.format, asset.isLittleEndian);
	try {
		const names = new Map<number, string>();
		const name = reader.readString();
		reader.align();
		const preloads = reader.readInt32();
		for (let at = 0; at < preloads; at += 1) {
			reader.readInt32();
			reader.readInt64();
		}
		const count = reader.readInt32();
		names.set(object.pathId, name);
		for (let at = 0; at < count; at += 1) {
			const place = reader.readString();
			reader.align();
			reader.readInt32();
			reader.readInt32();
			reader.readInt32();
			names.set(reader.readInt64(), place);
		}
		return names;
	} catch {
		return undefined;
	}
}

/** The kind of a place of the walk of an asset and the places of it, of the names of it. */
export interface UnityFsItem {
	offset: number;
	size: number;
	name: string;
	kind: string;
	encrypted: boolean;
	typeName: string;
}

/** `AssetDeserializer.ReadTextAsset`: the places of a script of an asset. */
function readUnityTextAsset(
	objectData: Buffer,
	asset: UnityAssetFile,
	object: UnityObjectHead,
):
	| { offset: number; size: number; encrypted: boolean; kind: string }
	| undefined {
	const type = readUnityObjectType(asset, object);
	const script = type?.children.find((node) => "m_Script" === node.name);
	if (!script) return undefined;
	const reader = new UnityReader(objectData.subarray(object.offset));
	reader.setup(asset.format, asset.isLittleEndian);
	try {
		reader.readString();
		reader.align();
		const size = reader.readUInt32();
		let kind = "text";
		let encrypted = 0 !== (script.flags & SCRIPT_CLASS_FLAG);
		if (encrypted) {
			const signature = reader.readUInt32();
			if (IMAGE_SIGNATURE === signature) {
				kind = "image";
			} else if (PNG_SIGNATURE === signature) {
				kind = "image";
				encrypted = false;
			}
		}
		return { offset: object.offset + reader.position, size, encrypted, kind };
	} catch {
		return undefined;
	}
}

/** The objects of one bundle of the file, of the walk of the asset of it. */
function readUnityBundleItems(
	stream: Buffer,
	bundle: UnityBundleEntry,
): UnityFsItem[] | undefined {
	const assetData = stream.subarray(bundle.offset, bundle.offset + bundle.size);
	const asset = readUnityAsset(assetData);
	if (!asset) return undefined;
	let idMap: Map<number, string> | undefined;
	for (const [typeId, tree] of asset.tree.typeTrees) {
		if ("AssetBundle" !== tree.type) continue;
		const object = asset.objects.find((place) => place.typeId === typeId);
		if (!object) continue;
		idMap = readUnityAssetBundleNames(assetData, asset, object);
		break;
	}
	const items: UnityFsItem[] = [];
	for (const object of asset.objects) {
		const typeName = readUnityObjectTypeName(asset, object);
		if ("AssetBundle" === typeName) continue;
		if ("AudioClip" === typeName) {
			// The reference reads the places of a sound of the engine of a walk of its own, of the table of
			// the places of the sound of it: this port stands of the objects of the asset itself.
			continue;
		}
		const fromMap = idMap?.get(object.pathId);
		const name = fromMap
			? shortenUnityPath(fromMap)
			: readUnityObjectName(assetData, asset, object);
		if ("TextAsset" === typeName) {
			const script = readUnityTextAsset(assetData, asset, object);
			if (!script) continue;
			items.push({
				offset: bundle.offset + script.offset,
				size: script.size,
				name,
				kind: script.kind,
				encrypted: script.encrypted,
				typeName,
			});
			continue;
		}
		items.push({
			offset: bundle.offset + object.offset,
			size: object.size,
			name,
			kind: "Texture2D" === typeName ? "image" : typeName,
			encrypted: false,
			typeName,
		});
	}
	return items;
}

/** The places of the file of an entry of a bundle of the engine. */
function itemOf(item: UnityFsItem, index: number): FixedEntry {
	const path = unreadKind(item.typeName)
		? item.name
		: `${item.name}.${item.kind}`;
	return {
		...createFixedEntry({
			id: index,
			path: path.length > 0 ? path : `object-${index}`,
			offset: BigInt(item.offset),
			size: BigInt(item.size),
			compressed: false,
			metadata: {
				type:
					"image" === item.kind
						? "image"
						: "text" === item.kind
							? "script"
							: "file",
				kind: item.kind,
				unityType: item.typeName,
				encrypted: item.encrypted,
			},
		}),
	};
}

/** Whether the places of a kind of an object of the engine stand of no walk this project holds. */
function unreadKind(typeName: string): boolean {
	return "Texture2D" === typeName || "AudioClip" === typeName;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const unityFsDescriptor: FormatDescriptor = {
	id: "unity-unityfs-archive",
	name: "Unity asset archive",
	extensions: ["unity3d", "asset", "bundle"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Unity/ArcUnityFS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const unityFsFormat: ArchiveFormat = defineFixedArchive({
	descriptor: unityFsDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("UnityFS", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readUnityFsHead(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const data = await readStored(source);
		const head = readUnityFsHead(data);
		if (!head) throw invalidArchive("Not an archive of the Unity engine");
		const indexData = readUnityFsIndexData(data, head);
		if (!indexData)
			throw invalidArchive("The index of the archive stands of no walk");
		const index = readUnityFsIndex(indexData, head.dataOffset);
		if (!index)
			throw invalidArchive("The index of the archive stands of no walk");
		const stream = unpackUnityFsSegments(data, index.segments);
		const entries: FixedEntry[] = [];
		for (const bundle of index.bundles) {
			const lower = bundle.name.toLowerCase();
			if (BUNDLE_UNREAD_KINDS.some((kind) => lower.endsWith(kind))) continue;
			const items = readUnityBundleItems(stream, bundle);
			if (!items) continue;
			for (const item of items) {
				entries.push(itemOf(item, entries.length));
			}
		}
		if (0 === entries.length) {
			// The reference hands the bundles themselves over where no object of them stands of a walk.
			for (const [place, bundle] of index.bundles.entries()) {
				entries.push(
					createFixedEntry({
						id: place,
						path: bundle.name.length > 0 ? bundle.name : `bundle-${place}`,
						offset: BigInt(bundle.offset),
						size: BigInt(bundle.size),
						compressed: false,
						metadata: { type: "file", kind: "bundle" },
					}),
				);
			}
		}
		return {
			entries,
			metadata: {
				unityVersion: head.engineVersion,
				unityRevision: head.revision,
				segments: index.segments.length,
				bundles: index.bundles.length,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const data = await readStored(source);
		const head = readUnityFsHead(data);
		if (!head) throw invalidArchive("Not an archive of the Unity engine");
		const indexData = readUnityFsIndexData(data, head);
		if (!indexData)
			throw invalidArchive("The index of the archive stands of no walk");
		const index = readUnityFsIndex(indexData, head.dataOffset);
		if (!index)
			throw invalidArchive("The index of the archive stands of no walk");
		const encrypted = false !== entry.metadata?.encrypted;
		if (encrypted) {
			throw unsupportedArchive(
				"The places of a sound of the engine stand of the walk of the engine to come",
			);
		}
		const stream = unpackUnityFsSegments(data, index.segments);
		const offset = Number(entry.offset);
		const size = Number(entry.size);
		return Readable.from([Buffer.from(stream.subarray(offset, offset + size))]);
	},
});
