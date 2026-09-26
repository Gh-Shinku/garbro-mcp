// The serialized assets of the Unity engine, of the reference `ArcFormats/Unity/AssetReader.cs`
// (`AssetReader`), `ArcFormats/Unity/Asset.cs` (`Asset`, `UnityObject`, `TypeTree`, `UnityTypeData`,
// `AssetRef`) and `ArcFormats/Unity/strings.dat`.
//
// An asset of the engine stands of a head (the counts of the file and the places of the walk of it), of a
// table of the kinds of a place of the walk of it (`TypeTree`) and of a table of the objects of it, every
// one of them of the places of its own within the file. The reference reads the places of a file of the
// engine of the kinds of the head of it; this port stands of the same walk, of the walk of a file of a
// buffer, and stands of the names of the kinds of the file of the reference (`strings.dat`) where the walk
// of a newer asset names a place of a name behind the places of the file itself.
//
// The reference reads the places of an object of the engine of a walk of its own (`UnityObject.Deserialize`
// and the kinds behind it), which the walk of the names of the objects of this port does not stand of: a
// port that lists the objects of an asset stands of the head of an object and of the names of the kinds of
// the table of it alone.

import { GarbroError } from "@garbro-mcp/core";
import { UNITY_STRINGS } from "./strings-dat.js";

const PLACES_PER_ALIGN = 4;
const ALIGN_MASK = PLACES_PER_ALIGN - 1;
const FORMAT_LITTLE_ENDIAN = 9;
const FORMAT_FIELD_ORDER = 22;
const FORMAT_TREE_DATA = 13;
const FORMAT_SCRIPT_ID = 17;
const FORMAT_LONG_IDS = 14;
const FORMAT_ID_FLAG = 7;
const FORMAT_ADDS = 11;
const FORMAT_REFS = 6;
const FORMAT_HEAD_LONG = 22;
const FORMAT_METHOD_TYPE = 17;
const NODE_SIZE_OLD = 24;
const NODE_SIZE_LONG = 32;
const HASH_SIZE = 0x10;
const SCRIPT_HASH_SIZE = 0x20;
const SCRIPT_CLASS_ID = 114;
const NULL_NAME = "(null)";
const TEXT_ENCODING = "utf8";
const HEAD_SIZE = 0x10;

function invalidAsset(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `AssetReader`: the walk of the places of a file of the engine, of the kind of the places of the count of
 * it (the places of a count of the two ways of the engine) and of the places of a count of the file behind
 * them.
 */
export class UnityReader {
	data: Buffer;
	format: number;
	littleEndian: boolean;
	longIds: boolean;
	position: number;

	constructor(data: Buffer) {
		this.data = data;
		this.format = 0;
		this.littleEndian = true;
		this.longIds = false;
		this.position = 0;
	}

	/** `SetupReaders`: the kind of the places of the count of the asset of the head of the walk. */
	setup(format: number, littleEndian: boolean): void {
		this.format = format;
		this.littleEndian = littleEndian;
		this.longIds = format >= FORMAT_LONG_IDS;
	}

	/** `SetupReadId`: the count of the places of the name of an object of the file. */
	setupReadId(longIds: boolean): void {
		this.longIds = longIds;
	}

	/** `AssetReader.Align`: the places of the walk of a file of a newer kind stand of four places. */
	align(): void {
		if (
			this.format >= FORMAT_LONG_IDS ||
			FORMAT_LITTLE_ENDIAN === this.format
		) {
			if (0 !== (this.position & ALIGN_MASK)) {
				this.position = (this.position + ALIGN_MASK) & ~ALIGN_MASK;
			}
		}
	}

	skip(count: number): void {
		this.position += count;
		if (this.position > this.data.length) {
			throw invalidAsset("The places of the asset stand short of the file");
		}
	}

	has(count: number): boolean {
		return this.position + count <= this.data.length;
	}

	readUInt8(): number {
		if (!this.has(1))
			throw invalidAsset("The places of the asset stand short of the file");
		const value = this.data[this.position] ?? 0;
		this.position += 1;
		return value;
	}

	readUInt16(): number {
		if (!this.has(2))
			throw invalidAsset("The places of the asset stand short of the file");
		const value = this.littleEndian
			? this.data.readUInt16LE(this.position)
			: this.data.readUInt16BE(this.position);
		this.position += 2;
		return value;
	}

	readInt16(): number {
		if (!this.has(2))
			throw invalidAsset("The places of the asset stand short of the file");
		const value = this.littleEndian
			? this.data.readInt16LE(this.position)
			: this.data.readInt16BE(this.position);
		this.position += 2;
		return value;
	}

	readUInt32(): number {
		if (!this.has(4))
			throw invalidAsset("The places of the asset stand short of the file");
		const value = this.littleEndian
			? this.data.readUInt32LE(this.position)
			: this.data.readUInt32BE(this.position);
		this.position += 4;
		return value;
	}

	readInt32(): number {
		if (!this.has(4))
			throw invalidAsset("The places of the asset stand short of the file");
		const value = this.littleEndian
			? this.data.readInt32LE(this.position)
			: this.data.readInt32BE(this.position);
		this.position += 4;
		return value;
	}

	readInt64(): number {
		if (!this.has(8))
			throw invalidAsset("The places of the asset stand short of the file");
		const value = this.littleEndian
			? this.data.readBigInt64LE(this.position)
			: this.data.readBigInt64BE(this.position);
		this.position += 8;
		return Number(value);
	}

	readUInt64(): number {
		if (!this.has(8))
			throw invalidAsset("The places of the asset stand short of the file");
		const value = this.littleEndian
			? this.data.readBigUInt64LE(this.position)
			: this.data.readBigUInt64BE(this.position);
		this.position += 8;
		return Number(value);
	}

	/** `AssetReader.ReadId`: the name of an object of the file, of the count of its places. */
	readId(): number {
		return this.longIds ? this.readInt64() : this.readInt32();
	}

	/** `AssetReader.ReadOffset`: the place of an object of the file, of the count of its places. */
	readOffset(): number {
		return this.format >= FORMAT_FIELD_ORDER
			? this.readInt64()
			: this.readUInt32();
	}

	readBool(): boolean {
		return 0 !== this.readUInt8();
	}

	/** `AssetReader.ReadCString`: the places of a name, of the place of no name behind them. */
	readCString(): string {
		const at = this.data.indexOf(0, this.position);
		const end = -1 === at ? this.data.length : at;
		const value = this.data.toString(TEXT_ENCODING, this.position, end);
		this.position = -1 === at ? this.data.length : at + 1;
		return value;
	}

	/** `AssetReader.ReadString`: the places of a name, of the count of them in front of them. */
	readString(): string {
		const length = this.readInt32();
		if (0 === length) return "";
		if (length < 0 || !this.has(length)) {
			throw invalidAsset("The places of the name stand short of the file");
		}
		const value = this.data.toString(
			TEXT_ENCODING,
			this.position,
			this.position + length,
		);
		this.position += length;
		return value;
	}

	readBytes(length: number): Buffer {
		if (!this.has(length))
			throw invalidAsset("The places of the asset stand short of the file");
		const value = Buffer.from(
			this.data.subarray(this.position, this.position + length),
		);
		this.position += length;
		return value;
	}
}

/** A place of the walk of the places of an asset of the engine. */
export interface UnityTypeNode {
	version: number;
	isArray: boolean;
	type: string;
	name: string;
	size: number;
	index: number;
	flags: number;
	children: UnityTypeNode[];
}

/** The table of the kinds of a place of the walk of an asset, of the places of it. */
export interface UnityTypeData {
	version: string;
	platform: number;
	classIds: number[];
	typeTrees: Map<number, UnityTypeNode>;
}

/** The head of an object of an asset. */
export interface UnityObjectHead {
	pathId: number;
	offset: number;
	size: number;
	typeId: number;
	classId: number;
	isDestroyed: boolean;
}

/** A place of the head of an asset that names a place of another asset. */
export interface UnityAssetRef {
	assetPath: string;
	guid: Buffer;
	type: number;
	filePath: string;
}

/** The walk of the head of an asset of the engine. */
export interface UnityAssetFile {
	format: number;
	isLittleEndian: boolean;
	dataOffset: number;
	tree: UnityTypeData;
	objects: UnityObjectHead[];
	adds: Map<number, number>;
	refs: UnityAssetRef[];
}

function newNode(): UnityTypeNode {
	return {
		version: 0,
		isArray: false,
		type: "",
		name: "",
		size: 0,
		index: 0,
		flags: 0,
		children: [],
	};
}

/** `TypeTree.GetString`: the places of a name, of the places of the file of the reference behind them. */
export function readUnityTreeString(
	blob: Buffer | undefined,
	offset: number,
): string {
	const places =
		offset < 0
			? UNITY_STRINGS
			: offset < (blob?.length ?? 0)
				? blob
				: undefined;
	if (!places) return NULL_NAME;
	const at = offset < 0 ? offset & 0x7fffffff : offset;
	const end = places.indexOf(0, at);
	const stop = -1 === end ? places.length : end;
	return places.toString(TEXT_ENCODING, at, stop);
}

/** `TypeTree.LoadRaw`: the table of a place of the walk of a file of the older kinds. */
function loadUnityTypeRaw(reader: UnityReader): UnityTypeNode {
	const node = newNode();
	node.type = reader.readCString();
	node.name = reader.readCString();
	node.size = reader.readInt32();
	node.index = reader.readUInt32();
	node.isArray = 0 !== reader.readInt32();
	node.version = reader.readInt32();
	node.flags = reader.readInt32();
	const count = reader.readInt32();
	if (count < 0 || count > 0x10000) {
		throw invalidAsset(
			"The table of the walk of the asset stands of a count of no end",
		);
	}
	for (let at = 0; at < count; at += 1) {
		node.children.push(loadUnityTypeRaw(reader));
	}
	return node;
}

/**
 * `TypeTree.LoadBlob`: the table of a place of the walk of a file of the newer kinds, of the places of a
 * run of the places of it and of the places of the names of it behind them.
 */
function loadUnityTypeBlob(reader: UnityReader, format: number): UnityTypeNode {
	const node = newNode();
	const count = reader.readInt32();
	const bufferBytes = reader.readInt32();
	const nodeSize = format >= 18 ? NODE_SIZE_LONG : NODE_SIZE_OLD;
	if (count < 0 || count > 0x10000 || bufferBytes < 0) {
		throw invalidAsset(
			"The table of the walk of the asset stands of a count of no end",
		);
	}
	const places = reader.readBytes(nodeSize * count);
	const blob = reader.readBytes(bufferBytes);
	if (format >= 21) reader.skip(4);
	const run = new UnityReader(places);
	run.setup(format, reader.littleEndian);
	const parents: UnityTypeNode[] = [node];
	for (let at = 0; at < count; at += 1) {
		const version = run.readInt16();
		const depth = run.readUInt8();
		let current = node;
		if (0 !== depth) {
			while (parents.length > depth) parents.pop();
			current = newNode();
			parents[parents.length - 1]?.children.push(current);
			parents.push(current);
		}
		current.version = version;
		current.isArray = 0 !== run.readUInt8();
		current.type = readUnityTreeString(blob, run.readInt32());
		current.name = readUnityTreeString(blob, run.readInt32());
		current.size = run.readInt32();
		current.index = run.readUInt32();
		current.flags = run.readInt32();
		if (format >= 18) run.readInt64();
	}
	return node;
}

/** `TypeTree.Load`: the table of a place of the walk of the asset, of the kind of the file of it. */
export function readUnityTypeNode(
	reader: UnityReader,
	format: number,
): UnityTypeNode {
	return 10 === format || format >= 12
		? loadUnityTypeBlob(reader, format)
		: loadUnityTypeRaw(reader);
}

/** `UnityTypeData.Load`: the table of the kinds of the walk of the asset. */
function readUnityTypeData(reader: UnityReader): UnityTypeData {
	const format = reader.format;
	const tree: UnityTypeData = {
		version: reader.readCString(),
		platform: reader.readInt32(),
		classIds: [],
		typeTrees: new Map(),
	};
	if (format >= FORMAT_TREE_DATA) {
		const hasTypeTrees = reader.readBool();
		const count = reader.readInt32();
		if (count < 0 || count > 0x10000) {
			throw invalidAsset(
				"The kinds of the walk of the asset stand of a count of no end",
			);
		}
		for (let at = 0; at < count; at += 1) {
			let classId = reader.readInt32();
			if (format >= FORMAT_SCRIPT_ID) {
				reader.readUInt8();
				const scriptId = reader.readInt16();
				if (SCRIPT_CLASS_ID === classId) {
					classId = scriptId >= 0 ? -2 - scriptId : -1;
				}
			}
			tree.classIds.push(classId);
			reader.readBytes(classId < 0 ? SCRIPT_HASH_SIZE : HASH_SIZE);
			if (hasTypeTrees) {
				tree.typeTrees.set(classId, readUnityTypeNode(reader, format));
			}
		}
		return tree;
	}
	const count = reader.readInt32();
	if (count < 0 || count > 0x10000) {
		throw invalidAsset(
			"The kinds of the walk of the asset stand of a count of no end",
		);
	}
	for (let at = 0; at < count; at += 1) {
		const classId = reader.readInt32();
		tree.typeTrees.set(classId, readUnityTypeNode(reader, format));
	}
	return tree;
}

/** `UnityObject.Load`: the head of an object of the asset. */
function readUnityObjectHead(
	reader: UnityReader,
	tree: UnityTypeData,
	dataOffset: number,
): UnityObjectHead {
	const pathId = reader.readId();
	const offset = reader.readOffset() + dataOffset;
	const size = reader.readUInt32();
	let typeId = 0;
	let classId = 0;
	if (reader.format < FORMAT_METHOD_TYPE) {
		typeId = reader.readInt32();
		classId = reader.readInt16();
	} else {
		typeId = reader.readInt32();
		classId = tree.classIds[typeId] ?? 0;
		typeId = classId;
	}
	let isDestroyed = false;
	if (reader.format <= 10) {
		isDestroyed = 0 !== reader.readInt16();
	}
	if (reader.format >= FORMAT_ADDS && reader.format < FORMAT_METHOD_TYPE) {
		reader.readInt16();
	}
	if (reader.format >= 15 && reader.format < FORMAT_METHOD_TYPE) {
		reader.readUInt8();
	}
	return { pathId, offset, size, typeId, classId, isDestroyed };
}

/** `AssetRef.Load`: a place of the head of an asset that names a place of another asset. */
function readUnityAssetRef(reader: UnityReader): UnityAssetRef {
	return {
		assetPath: reader.readCString(),
		guid: reader.readBytes(16),
		type: reader.readInt32(),
		filePath: reader.readCString(),
	};
}

/** `Asset.Load`: the walk of the head of an asset of the engine. */
export function readUnityAsset(data: Buffer): UnityAssetFile | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	const reader = new UnityReader(data);
	try {
		reader.readInt32(); // the count of the places of the head of the file
		reader.readUInt32(); // the count of the places of the file
		const format = reader.readInt32();
		let dataOffset = reader.readUInt32();
		let littleEndian = true;
		if (format >= FORMAT_LITTLE_ENDIAN) littleEndian = 0 === reader.readInt32();
		if (format >= FORMAT_HEAD_LONG) {
			reader.readInt32();
			reader.readInt64();
			dataOffset = reader.readInt64();
			reader.readInt64();
		}
		reader.setup(format, littleEndian);
		const tree = readUnityTypeData(reader);
		let longIds = format >= FORMAT_LONG_IDS;
		if (format >= FORMAT_ID_FLAG && format < FORMAT_LONG_IDS) {
			longIds = 0 !== reader.readInt32();
		}
		reader.setupReadId(longIds);
		const objectCount = reader.readInt32();
		if (objectCount < 0 || objectCount > 0x100000) return undefined;
		const objects: UnityObjectHead[] = [];
		const seen = new Set<number>();
		for (let at = 0; at < objectCount; at += 1) {
			reader.align();
			const object = readUnityObjectHead(reader, tree, dataOffset);
			if (seen.has(object.pathId)) {
				throw invalidAsset("The asset stands of two objects of one name");
			}
			seen.add(object.pathId);
			objects.push(object);
		}
		const adds = new Map<number, number>();
		if (format >= FORMAT_ADDS) {
			const count = reader.readInt32();
			if (count < 0 || count > 0x100000) return undefined;
			for (let at = 0; at < count; at += 1) {
				reader.align();
				const fileId = reader.readInt32();
				adds.set(reader.readId(), fileId);
			}
		}
		const refs: UnityAssetRef[] = [];
		if (format >= FORMAT_REFS) {
			const count = reader.readInt32();
			if (count < 0 || count > 0x100000) return undefined;
			for (let at = 0; at < count; at += 1) {
				refs.push(readUnityAssetRef(reader));
			}
		}
		reader.readCString();
		return {
			format,
			isLittleEndian: littleEndian,
			dataOffset,
			tree,
			objects,
			adds,
			refs,
		};
	} catch {
		return undefined;
	}
}

/** `UnityObject.Type`: the kind of a place of the walk of an object of the asset. */
export function readUnityObjectType(
	asset: UnityAssetFile,
	object: UnityObjectHead,
): UnityTypeNode | undefined {
	return asset.tree.typeTrees.get(object.typeId);
}

/** `UnityObject.TypeName`: the name of the kind of an object of the asset. */
export function readUnityObjectTypeName(
	asset: UnityAssetFile,
	object: UnityObjectHead,
): string {
	const type = readUnityObjectType(asset, object);
	if (type) return type.type;
	return `[TypeId:${object.typeId}]`;
}
