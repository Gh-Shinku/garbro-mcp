// The object graph of the rUGP engine: the walks of `CRioArchive` behind the core, and the objects of the
// engine the archives of a game carry (`ArcFormats/rUGP/ArcRIO.cs`, classes `CObject`, `COceanNode`,
// `CObjectArcMan`, `CInstallSource`, `CrelicUnitedGameProject`, `CUnknown1`, `CStdb`, `CBoxOcean`,
// `CObjectOcean`, `CStringArray` and `CPtrArray`). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0,
// MIT License.
//
// An archive of this engine holds a **graph of objects** rather than a table of entries: the core of
// `rio-core.ts` reads the classes and the places of the graph, and this module walks the graph itself and the
// objects behind it. Two pieces of the reference stand as `NotImplementedException` and are therefore
// refused here as well rather than guessed at:
//
//  * the class list of an archive that is **not** encrypted reads a name per node and looks it up in a map
//    the reference never filled (`FindObject`), so only an archive whose graph stands of no node at all is
//    readable that way. An encrypted archive stands of the node walk instead, which is the one the archives
//    of a game carry.
//  * the message classes of a type (`ReadMsgClass`, `GetRtcFromMessageName`) and the anonymous references
//    of `ReadRioReference` (`CreateAnonymousRio`) stand unported.
//
// One quirk of the reference is kept as it stands: the class of the object the opener of an archive reads is
// taken from the **name** of its node (`ReadObject`), and only the nodes a reference of an encrypted graph
// made carry the name of a class — the nodes of the load array carry the name `unrefix`.

import { decodeCp932, GarbroError } from "@garbro-mcp/core";
import {
	decodeRioOffset,
	decodeRioSize,
	readRioBool,
	readRioCount,
	readRioEncrypted,
	readRioString,
	RIO_BASIC_TYPES,
	RIO_ENCRYPTED_SIGNATURE,
	RIO_SIGNATURE,
	RioClassReader,
	RioStream,
} from "./rio-core.js";

/** The count of the places of the schema of a message class, behind the count of the walk of a type. */
const TYPE_MESSAGE = 0x369e;
const TYPE_CLASS = 0x1e57;
const TYPE_BASIC_1 = 0x2d6b;
const TYPE_BASIC_2 = 0x2f1a;
/** The count of the places of a name of a basic type of the engine. */
const BASIC_TYPE_PLACES = 0x40;
/** The depth the walk of the graph of the reference stands of, and the count of the places of a name. */
const MAX_RECURSION_DEPTH = 40;
/** The key the project of a game stands of, of the walk of its own payload. */
export const RIO_RELIC_KEY = 0x7e6b8ce2;

/** The object of the graph of the engine: the class of it, its flags, and the walk of its own places. */
export abstract class RioObject {
	flags = 0;
	className = "";

	abstract deserialize(arc: RioArchive): void;
}

/** `COceanNode`: the node of the graph, of the class of the object behind it and the places of it. */
export class RioOceanNode extends RioObject {
	name: string;
	parent: RioObject | undefined;
	offset = 0;
	size = 0;

	constructor(name: string) {
		super();
		this.name = name;
	}

	deserialize(): void {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			"rUGP node of the graph stands unported",
		);
	}

	/** `GetPathName`: the names of the nodes of it to the root of the graph, of the engine's separator. */
	getPathName(): string {
		const names: string[] = [];
		let node: RioObject | undefined = this;
		while (
			node instanceof RioOceanNode &&
			node.className !== null &&
			node.name !== ""
		) {
			names.push(node.name);
			node = node.parent;
		}
		return names.reverse().join("/");
	}
}

/** `CStringArray`: a run of strings of the stream. */
export class RioStringArray extends RioObject {
	places: string[] = [];

	deserialize(arc: RioArchive): void {
		const count = readRioCount(arc.source);
		if (count === undefined || count < 0) {
			throw new GarbroError("INVALID_ARCHIVE", "rUGP run of strings");
		}
		this.places = [];
		for (let at = 0; at < count; at += 1) {
			this.places.push(arc.readString());
		}
	}
}

/** `CInstallSource`: the record of one archive of a game within the manifest of the engine. */
export class RioInstallSource extends RioObject {
	version = 0;
	field14 = 0;
	field18 = 0;
	rioName = "";
	rioOffset = 0n;
	rioSize = 0n;
	fieldA8 = 0;
	fieldB0 = 0;
	fieldD4: Buffer = Buffer.alloc(0);

	deserialize(arc: RioArchive): void {
		this.version = arc.readUInt16();
		if (this.version >= 7) {
			this.field14 = arc.readInt32();
			this.field18 = arc.readInt32();
			arc.readByte();
			arc.readString();
		}
		// The branch of the registry, the disk, the name of the archive as it stands, and the places behind
		// them, of which the reference reads and stands of none.
		arc.readString();
		arc.readString();
		arc.readString();
		arc.readString();
		arc.readString();
		arc.readInt64();
		arc.readInt64();
		if (this.version < 6) {
			arc.readInt32();
			arc.readInt32();
		} else {
			arc.readInt32();
		}
		this.rioName = arc.readString();
		this.rioOffset = arc.readInt64();
		this.rioSize = arc.readInt64();
		if (this.version < 6) arc.readInt64();
		arc.readInt32();
		arc.readString();
		arc.readInt32();
		arc.readInt32();
		arc.readInt32();
		arc.readInt32();
		arc.readInt32();
		arc.readString();
		const count = readRioCount(arc.source);
		if (count === undefined || count < 0) {
			throw new GarbroError("INVALID_ARCHIVE", "rUGP run of an archive record");
		}
		arc.readBytes(count * 4);
		this.#prepareBuffer();
		arc.read(this.fieldD4.length);
	}

	#prepareBuffer(): void {
		this.fieldB0 = Number((this.rioSize + 0xffffn) >> 16n);
		this.fieldA8 = 16;
		const length = (this.fieldB0 + 7) >> 3;
		this.fieldD4 = Buffer.alloc(Math.max(0, length), 0x00);
	}
}

/** `CPtrArray`: a run of objects, of a place of one standing before every object of it. */
export class RioPtrArray<T extends RioObject> extends RioObject {
	readonly places: (T | undefined)[] = [];

	constructor(readonly inner?: new () => T) {
		super();
	}

	deserialize(arc: RioArchive): void {
		const count = readRioCount(arc.source);
		if (count === undefined || count < 0) {
			throw new GarbroError("INVALID_ARCHIVE", "rUGP run of objects");
		}
		this.places.length = 0;
		for (let at = 0; at < count; at += 1) {
			const stood = readRioBool(arc.source);
			if (stood === undefined) {
				throw new GarbroError("INVALID_ARCHIVE", "rUGP run of objects");
			}
			if (!stood || !this.inner) {
				this.places.push(undefined);
				continue;
			}
			const object = new this.inner();
			this.places.push(object);
			object.deserialize(arc);
		}
	}
}

/** `CObjectArcMan`: the manifest of a game, of the archives it ships and the places of its index. */
export class RioObjectArcMan extends RioObject {
	version = 0;
	title = "";
	arcList = new RioPtrArray<RioInstallSource>(RioInstallSource);
	field14 = 0x1873be26;
	field1C = 0;
	field20 = 0;
	tocOffset = 0;
	tocSize = 0;
	field38 = 0x14;
	rioFileName: string | undefined;
	field80 = new RioStringArray();
	field98 = 0x30;

	deserialize(arc: RioArchive): void {
		this.version = arc.readInt32();
		this.field14 = arc.readInt32();
		arc.readByte();
		arc.readByte();
		if (this.version < 10) {
			this.field1C = 0;
			this.field20 = 0;
		} else {
			this.field1C = arc.readInt32();
			this.field20 = arc.readInt32();
		}
		arc.readInt32();
		arc.readInt32();
		arc.readInt32();
		if (this.version >= 6) {
			this.tocOffset = arc.readInt32();
			this.tocSize = arc.readInt32();
			arc.readInt32();
		}
		if (this.version >= 8) this.field38 = arc.readInt32();
		this.title = arc.readString();
		arc.readInt32();
		arc.readString();
		arc.readInt32();
		arc.readString();
		arc.readString();
		arc.readString();
		arc.readInt32();
		arc.readString();
		this.field80.deserialize(arc);
		arc.readInt32();
		if (this.version >= 9) this.rioFileName = arc.readString();
		if (this.version >= 7) arc.readString();
		if (this.version >= 5) this.field98 = arc.readInt32();
		this.arcList.deserialize(arc);
		for (const entry of this.arcList.places) {
			if (entry === undefined) continue;
			entry.field14 = this.field1C;
			entry.field18 = this.field20;
		}
	}
}

/** `CUnknown1`: the block of the version of a project, of the strings of its release. */
export class RioUnknown1 extends RioObject {
	version = 0;
	field04: string | undefined;
	field08 = "";
	field0C = "";
	field14 = "";
	field18 = 1000;
	field1C = "";
	field10: string | undefined;
	field20 = 1;
	field24 = 1;
	field28: Buffer | undefined;
	field38 = 0;
	field3C = "";
	field40 = "";
	field44: string | undefined;
	field48: string | undefined;
	field4C: string | undefined;
	field50: string | undefined;

	deserialize(arc: RioArchive): void {
		this.version = arc.readInt32();
		if (this.version >= 2) this.field04 = arc.readString();
		this.field08 = arc.readString();
		this.field0C = arc.readString();
		this.field14 = arc.readString();
		this.field1C = arc.readString();
		this.field18 = arc.readInt32();
		if (0 === this.version) return;
		if (this.version >= 2) {
			this.field28 = arc.readBytes(16);
			this.field38 = arc.readInt32();
		}
		this.field3C = arc.readString();
		this.field40 = arc.readString();
		if (this.version >= 3) this.field44 = arc.readString();
		if (this.version >= 4) {
			this.field10 = arc.readString();
			this.field20 = arc.readInt32();
		}
		if (this.version >= 5) {
			this.field24 = arc.readInt32();
		} else if (this.version >= 2) {
			this.field24 = (this.field28?.readUInt16LE(0) ?? 0) < 0x7d3 ? 2 : 1;
		}
		if (this.version >= 6) {
			this.field48 = arc.readString();
			this.field4C = arc.readString();
			this.field50 = arc.readString();
		}
	}
}

/** `CStdb`: a name of the engine. */
export class RioStdb extends RioObject {
	field0C = "";

	deserialize(arc: RioArchive): void {
		this.field0C = arc.readString();
	}
}

/** `CObjectOcean`: an object of the graph of no places of its own. */
export class RioObjectOcean extends RioObject {
	deserialize(): void {}
}

/** `CBoxOcean`: the box of a game, of the pictures and the strings of its menu. */
export class RioBoxOcean extends RioObject {
	field10: RioObject | undefined;
	field14: RioObject | undefined;
	field18: (RioObject | undefined)[] = [];
	field118: string[] = [];
	field198: RioObject | undefined;
	boxList: (RioObject | undefined)[] = [];

	deserialize(arc: RioArchive): void {
		this.field10 = arc.readRioReference("CFrameBuffer");
		const schema = arc.objectSchema;
		if (schema < 3) {
			for (let at = 0; at < 32; at += 1) {
				this.boxList.push(arc.readRioReference("CBox"));
			}
		}
		if (schema >= 2) {
			this.field14 = arc.readRioReference("CSbm");
			if (schema < 6) {
				this.field18.push(arc.readRioReference("CSbm"));
			} else {
				const refCount = schema >= 7 ? 32 : 15;
				const strCount = schema >= 7 ? 32 : 0;
				for (let at = 0; at < refCount; at += 1) {
					this.field18.push(arc.readRioReference("CSbm"));
				}
				for (let at = 0; at < strCount; at += 1) {
					this.field118.push(arc.readString());
				}
			}
			this.field198 = arc.readRioReference("CUnitedMenu");
			if (schema >= 4) {
				this.#readCui(arc);
				if (schema >= 5) {
					arc.readRioReference("CUI");
					this.#readCui(arc);
				}
			}
		}
	}

	#readCui(arc: RioArchive): void {
		while (arc.readByte() !== 0) {
			arc.readRioReference("CUI");
		}
	}
}

/** `CrelicUnitedGameProject`: the project of a game, of the objects of its own. */
export class RioRelicProject extends RioObject {
	version = 0;
	field08: RioObject | undefined;
	field0C: RioObject | undefined;
	field10: RioObject | undefined;
	field14: RioObject | undefined;
	field18: RioObject | undefined;
	field1C: RioObject | undefined;
	field24: RioObject | undefined;
	field28: RioObject | undefined;
	field2C: RioObject | undefined;
	field30: RioObject | undefined;
	field34 = new RioUnknown1();
	field38: RioObject | undefined;

	deserialize(arc: RioArchive): void {
		if (arc.isEncrypted) {
			// The places of the project stand of a payload of their own behind the places of the archive.
			const data = readRioEncrypted(arc.source, RIO_RELIC_KEY);
			if (data === undefined) {
				throw new GarbroError("INVALID_ARCHIVE", "rUGP project payload");
			}
			const previous = arc.setSource(new RioStream(data));
			try {
				this.readRelic(arc);
			} finally {
				arc.setSource(previous);
			}
		} else {
			this.readRelic(arc);
		}
	}

	readRelic(arc: RioArchive): void {
		this.version = arc.readInt32();
		if (this.version >= 0x24) {
			this.field24 = arc.readRioReference("CDatabaseBase");
			this.field28 = arc.readRioReference("CDatabaseBase");
			this.field10 = arc.readRioReference("CBoxOcean");
			this.field14 = arc.readRioReference("CObjectOcean");
			this.field18 = arc.readRioReference("CObjectOcean");
			this.field0C = arc.readRioReference("CProcessOcean");
			if (this.version >= 0x25) {
				this.field30 = arc.readRioReference("CStdb");
			}
			if (this.version >= 0x26) {
				this.field2C = arc.readRioReference("CRio");
			}
			if (this.version >= 0x27) this.field1C = arc.readRioReference("CRio");
			if (this.version >= 0x29) this.field38 = arc.readRioReference("CRio");
			this.field34.deserialize(arc);
			if (this.version >= 0x28) this.field08 = arc.readRioReference("CRio");
		} else if (this.version >= 0x20) {
			this.field0C = arc.readRioReference("CProcessOcean");
			this.field10 = arc.readRioReference("CBoxOcean");
			this.field14 = arc.readRioReference("CObjectOcean");
			this.field18 = arc.readRioReference("CObjectOcean");
			this.field1C = arc.readRioReference("CSoundManEx");
			if (this.version >= 0x23) {
				this.field24 = arc.readRioReference("CDatabaseBase");
			}
			if (this.version >= 0x22) {
				this.field28 = arc.readRioReference("CDatabaseBase");
			}
			if (this.version >= 0x21) this.field34.deserialize(arc);
		} else {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`rUGP schema ${this.version} stands unported`,
			);
		}
	}
}

/** The classes of the graph of the engine, of the works the walk of one of them stands of. */
const CLASS_TABLE: ReadonlyMap<string, () => RioObject> = new Map<
	string,
	() => RioObject
>([
	["CObjectArcMan", () => new RioObjectArcMan()],
	["CrelicUnitedGameProject", () => new RioRelicProject()],
	["CStdb", () => new RioStdb()],
	["CObjectOcean", () => new RioObjectOcean()],
	["CBoxOcean", () => new RioBoxOcean()],
]);

/** `CRioArchive.CreateObject`: the object of a class of the graph, of the table of the engine. */
export function createRioObject(className: string): RioObject {
	const factory = CLASS_TABLE.get(className);
	if (!factory) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`rUGP class '${className}' stands unported`,
		);
	}
	return factory();
}

/** `COceanNode.GetPathName`, of a node of the graph the test can stand of. */
export function rioNodePath(node: RioOceanNode): string {
	return node.getPathName();
}

/**
 * `CRioArchive`: the walk of the graph of an archive, of the stream it reads and the classes of it. The
 * stream is a `RioStream` of the core, and the places of the graph stand of the stream the archive was read
 * of until a walk replaces it (`setSource`), which the project of a game stands of for its payload.
 */
export class RioArchive extends RioClassReader {
	source: RioStream;
	readonly shift: number;
	readonly #oceanMap = new Map<number, RioOceanNode>();
	#depth = 0;
	#field60 = false;

	constructor(source: RioStream, shift = 0, encrypted = false) {
		super();
		this.source = source;
		this.shift = shift;
		if (encrypted) this.fieldFlags |= 4;
	}

	/** `SetSource`: the stream of the places of the graph, which the payload of a project stands of. */
	setSource(source: RioStream): RioStream {
		const previous = this.source;
		this.source = source;
		return previous;
	}

	get input(): RioStream {
		return this.source;
	}

	override get objectSchema(): number {
		return this.objectSchemaValue;
	}

	/** `DeserializeRoot`: the root of the graph, of the mark of the archive and the class of it. */
	deserializeRoot(): RioObject {
		this.#populateLoadArray();
		const walked = this.loadRioTypeCore(this.source);
		if (!walked || walked.className === null) {
			throw new GarbroError("INVALID_ARCHIVE", "rUGP root of the graph");
		}
		const object = createRioObject(walked.className);
		this.#mapObjectEntry(object);
		if (walked.signature === RIO_SIGNATURE) {
			object.flags |= 0x80;
		} else if (walked.signature === RIO_ENCRYPTED_SIGNATURE) {
			object.flags |= 0x180;
		}
		this.deserializeClassList(object);
		object.deserialize(this);
		return object;
	}

	/** `ReadObject`: the object of one node of the graph, of the places and the class of it. */
	readObject(node: RioOceanNode): RioObject {
		this.#field60 = false;
		const object = createRioObject(node.name);
		this.#populateLoadArray();
		// The places of the node stand of the count of the places of the head of the walk of the archive.
		this.source.position = node.offset * 2 ** this.shift;
		const first = this.readByte() & 3;
		const second = this.readByte();
		this.readByte();
		// The count of the places of the object of a node stands of the places of the two bytes behind the
		// places of the flags, of the count of the highest two places of the second of them: the third and
		// the fourth kinds stand of a place of their own behind the three.
		const kind = second >> 6;
		if (2 === kind || 3 === kind) this.readByte();
		object.flags = node.flags;
		this.#mapObjectEntry(object);
		if (2 === first) {
			const flags = this.readUInt16();
			this.fieldFlags = (this.fieldFlags & 0xffff) | (flags << 16);
		} else if (3 === first) {
			this.readUInt16();
			const flags = this.readUInt16();
			this.fieldFlags = (this.fieldFlags & 0xffff) | (flags << 16);
		}
		object.deserialize(this);
		return object;
	}

	/** `DeserializeClassList`: the count of the nodes of a class, and the walk of every one of them. */
	deserializeClassList(root: RioObject): void {
		if (this.isEncrypted && 0 !== (root.flags & 0x200)) return;
		try {
			this.#depth += 1;
			if (this.#depth > MAX_RECURSION_DEPTH) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"rUGP graph stands deeper than the walk of it",
				);
			}
			const count = readRioCount(this.source);
			if (count === undefined || count < 0) {
				throw new GarbroError("INVALID_ARCHIVE", "rUGP class list");
			}
			for (let at = 0; at < count; at += 1) {
				if (this.isEncrypted) {
					const node = new RioOceanNode("unrefix");
					this.deserializeNode(node, true);
					node.parent = root;
				} else {
					// The walk of a class list of an archive that does not stand encrypted reads the name of
					// every node and hands it to the map of the reference, which is never filled: the port
					// refuses it rather than walk a graph of no names. The name of the node stands read here
					// so that the refusal names the place the walk of the reference stands at.
					void this.readString();
					throw new GarbroError(
						"UNSUPPORTED_FEATURE",
						"rUGP class list of an archive that stands unencrypted",
					);
				}
			}
		} finally {
			this.#depth -= 1;
		}
	}

	/** `DeserializeNode`: one node of the graph, of the places of it where it carries a run of its own. */
	deserializeNode(node: RioOceanNode, storeToMap = true): void {
		const flags = this.readUInt16();
		let className: string | null;
		switch (flags & 7) {
			case 0:
				if (0 !== (flags & 0x8000)) this.readByte();
				else this.readUInt16();
				className = this.readClass(this.source)?.className ?? null;
				break;
			case 1:
				this.readInt32();
				className = this.readCType();
				break;
			default:
				throw new GarbroError("INVALID_ARCHIVE", "rUGP node of the graph");
		}
		node.className = className ?? "";
		if (storeToMap) node.flags = flags;
		if (0 !== (flags & 8)) {
			if (!storeToMap) node.flags |= 8;
			const first = this.readInt32();
			const second = this.readInt32();
			if (this.isEncrypted && storeToMap) {
				node.flags |= 0x100;
				if (!this.#oceanMap.has(first)) this.#oceanMap.set(first, node);
			}
			node.offset = first >>> 0;
			node.size = second >>> 0;
		} else {
			if (0 === (flags & 8)) {
				throw new GarbroError("INVALID_ARCHIVE", "rUGP node of no places");
			}
			const id = this.readInt32();
			this.readInt32();
			const found = this.#oceanMap.get(id);
			if (!found) {
				throw new GarbroError("INVALID_ARCHIVE", "rUGP node of the graph");
			}
			node = found;
		}
		this.deserializeClassList(node);
	}

	/** `ReadRioReference`: one reference of the graph, of the class it names and the places of it. */
	readRioReference(baseRef: string): RioObject | undefined {
		if (!this.#field60) {
			this.#field60 = true;
			if (this.isEncrypted) {
				const count = this.readShortCount();
				if (count === undefined || count < 0) {
					throw new GarbroError("INVALID_ARCHIVE", "rUGP references");
				}
				for (let at = 0; at < count; at += 1) this.#mapObjectEntry(undefined);
			}
		}
		const walked = this.readClass(this.source);
		if (!walked) {
			throw new GarbroError("INVALID_ARCHIVE", "rUGP reference");
		}
		if (walked.className === null) {
			const index = walked.tag;
			if (index >= this.loadArray.length) {
				throw new GarbroError("INVALID_ARCHIVE", "rUGP reference of a class");
			}
			return this.loadArray[index] as RioObject | undefined;
		}
		const flags = this.readUInt16();
		if (0 !== (flags & 0x40)) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				"rUGP anonymous reference stands unported",
			);
		}
		let first = 0;
		let second = 0;
		if (this.isEncrypted) {
			first = this.readInt32();
			second = this.readInt32();
		} else {
			this.readString();
		}
		const rio = this.readRioReference("CRio");
		if (!rio) throw new GarbroError("INVALID_ARCHIVE", "rUGP reference");
		if (0 !== (flags & 7)) this.readInt32();
		else if (0 !== (flags & 0x8000)) this.readByte();
		else this.readUInt16();
		if (!this.isEncrypted) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				"rUGP reference of an archive that stands unencrypted",
			);
		}
		const node = this.#oceanMap.get(first);
		if (!node) {
			throw new GarbroError("INVALID_ARCHIVE", "rUGP reference of no node");
		}
		node.offset = decodeRioOffset(first);
		node.size = decodeRioSize(second);
		node.name = baseRef;
		this.#mapObjectEntry(node);
		return node;
	}

	/** `ReadCType`: the class of a type, of the count in front of it. */
	readCType(): string | null {
		const kind = this.readUInt16();
		switch (kind) {
			case TYPE_CLASS:
				return this.readClass(this.source)?.className ?? null;
			case TYPE_BASIC_1:
			case TYPE_BASIC_2:
				return this.readBasicType();
			case TYPE_MESSAGE:
				throw new GarbroError(
					"UNSUPPORTED_FEATURE",
					"rUGP message class stands unported",
				);
			default:
				throw new GarbroError("INVALID_ARCHIVE", "rUGP type of the graph");
		}
	}

	/** `ReadBasicType`: a basic type of the engine, of the name it writes it of. */
	readBasicType(): string {
		this.readUInt16();
		const length = this.readUInt16();
		if (length >= BASIC_TYPE_PLACES) {
			throw new GarbroError("INVALID_ARCHIVE", "rUGP basic type");
		}
		const name = decodeCp932(this.readBytes(length));
		const mapped = RIO_BASIC_TYPES.get(name);
		if (mapped === undefined) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`rUGP basic type '${name}' stands unported`,
			);
		}
		return mapped;
	}

	#populateLoadArray(): void {
		this.loadArray.length = 0;
		this.loadArray.push(null, this);
	}

	#mapObjectEntry(node: RioObject | undefined): void {
		this.loadArray.push(node);
	}

	// The primitives of the stream, of the places of the graph of this archive.
	readByte(): number {
		const place = this.source.readByte();
		if (place === undefined) {
			throw new GarbroError("INVALID_ARCHIVE", "rUGP stream ends");
		}
		return place;
	}

	readUInt16(): number {
		const place = this.source.readUInt16();
		if (place === undefined) {
			throw new GarbroError("INVALID_ARCHIVE", "rUGP stream ends");
		}
		return place;
	}

	readInt32(): number {
		const place = this.source.readInt32();
		if (place === undefined) {
			throw new GarbroError("INVALID_ARCHIVE", "rUGP stream ends");
		}
		return place;
	}

	readInt64(): bigint {
		const place = this.source.readInt64();
		if (place === undefined) {
			throw new GarbroError("INVALID_ARCHIVE", "rUGP stream ends");
		}
		return place;
	}

	readString(): string {
		const place = readRioString(this.source);
		if (place === undefined) {
			throw new GarbroError("INVALID_ARCHIVE", "rUGP string");
		}
		return place;
	}

	readShortCount(): number | undefined {
		const count = this.source.readByte();
		if (count === undefined) return undefined;
		return count === 0xff ? this.source.readUInt16() : count;
	}

	readBytes(count: number): Buffer {
		const run = this.source.readBytes(count);
		if (run === undefined) {
			throw new GarbroError("INVALID_ARCHIVE", "rUGP run of places");
		}
		return run;
	}

	read(count: number): void {
		this.readBytes(count);
	}
}
