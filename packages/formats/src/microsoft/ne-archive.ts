// Format reference: GARbro Experimental/Microsoft/ArcNE.cs (class `NeExeOpener`).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";

/** `NeExeOpener.TryOpen` looks for the DOS stub and the NE header it points at. */
const DOS_SIGNATURE = Buffer.from("MZ", "latin1");
const DOS_HEADER_SIZE = 0x40;
const NE_HEADER_AT = 0x3c;
const NE_SIGNATURE = "NE";
const NE_RESOURCE_TABLE_AT = 0x24;
/** A type record is its id, its entry count and a reserved word; an entry record is twelve bytes. */
const TYPE_RECORD_SIZE = 8;
const ENTRY_RECORD_SIZE = 12;
const ENTRY_NAME_WIDTH = 5;
/** The resource type whose payload the reference reformats as text. */
const RT_VERSION = 16;

/** `NeExeOpener.TypeMap`: the resource types the reference gives a name to. */
export const NE_RESOURCE_TYPE_NAMES: ReadonlyMap<number, string> = new Map([
	[1, "RT_CURSOR"],
	[2, "RT_BITMAP"],
	[3, "RT_ICON"],
	[4, "RT_MENU"],
	[5, "RT_DIALOG"],
	[6, "RT_STRING"],
	[10, "RT_DATA"],
	[11, "RT_MESSAGETABLE"],
	[16, "RT_VERSION"],
]);

export interface NeResourcePlan {
	readonly index: number;
	readonly name: string;
	readonly offset: bigint;
	readonly size: bigint;
	/** `NeResourceEntry.NativeType`, with the integer flag cleared. */
	readonly typeId: number;
	/** `NeResourceEntry.NativeName`, with the integer flag cleared. */
	readonly nameId: number;
	/**
	 * The directory the reference files the entry under: its name for a type whose word carried the
	 * integer flag and that the table lists, and the type id for every other type.
	 */
	readonly typeName: string;
}

export interface NeLayout {
	/** The resource alignment shift count, applied to both the offsets and the sizes. */
	readonly shift: number;
	readonly entries: readonly NeResourcePlan[];
}

/** `NeExeOpener.TryOpen`: walks the resource table of the NE header.
 *
 * `NeExeOpener.OpenVersion` is meant to reformat the `RT_VERSION` payload as text, but its own read
 * cannot reach that code: it consumes the resource length and the value length and then compares the
 * next string with `VS_VERSION_INFO`, while the next field is the type word, i.e. two zero bytes that
 * read as an empty string, and it decodes the key as CP932 although the key is a UTF-16 string. The
 * comparison therefore always fails and the stored bytes are returned. The sibling parser in
 * `Experimental/Microsoft/ArcEXE.cs` reads that word and decodes the key as UTF-16, which is where the
 * difference can be seen. This port keeps to the reference and hands the payload over unchanged; the
 * `versionResource` entry flag marks the resource so a caller can tell it apart.
 */
export function readNeLayout(
	data: Buffer,
	fileSize: bigint,
): NeLayout | undefined {
	if (
		data.length < DOS_HEADER_SIZE ||
		!data.subarray(0, 2).equals(DOS_SIGNATURE)
	)
		return undefined;
	const neOffset = data.readUInt32LE(NE_HEADER_AT);
	if (BigInt(neOffset) + 2n > fileSize || neOffset + 2 > data.length)
		return undefined;
	if (data.toString("latin1", neOffset, neOffset + 2) !== NE_SIGNATURE)
		return undefined;
	let tableAt = data.readUInt16LE(neOffset + NE_RESOURCE_TABLE_AT) + neOffset;
	if (BigInt(tableAt) <= BigInt(neOffset) || BigInt(tableAt) >= fileSize)
		return undefined;
	if (tableAt + 2 > data.length) return undefined;
	const shift = data.readUInt16LE(tableAt);
	tableAt += 2;
	const entries: NeResourcePlan[] = [];
	while (BigInt(tableAt) + 1n < fileSize && tableAt + 2 <= data.length) {
		const rawType = data.readUInt16LE(tableAt);
		if (0 === rawType) break;
		let typeId = rawType;
		let directory: string | undefined;
		if (0 !== (rawType & 0x8000)) {
			typeId = rawType & 0x7fff;
			directory = NE_RESOURCE_TYPE_NAMES.get(typeId);
		}
		if (tableAt + 4 > data.length) return undefined;
		const count = data.readUInt16LE(tableAt + 2);
		tableAt += TYPE_RECORD_SIZE;
		const typeName = directory ?? `#${typeId}`;
		for (let index = 0; index < count; index += 1) {
			// The reference walks past the end of a malformed table and lets the read throw; the port
			// stops instead, at the cost of opening no archive a well formed table would not describe.
			if (tableAt + ENTRY_RECORD_SIZE > data.length) return undefined;
			const offset = (data.readUInt16LE(tableAt) << shift) >>> 0;
			const size = (data.readUInt16LE(tableAt + 2) << shift) >>> 0;
			const rawName = data.readUInt16LE(tableAt + 6);
			const nameId = 0 !== (rawName & 0x8000) ? rawName & 0x7fff : rawName;
			tableAt += ENTRY_RECORD_SIZE;
			entries.push({
				index: entries.length,
				name: `${typeName}/${String(nameId).padStart(ENTRY_NAME_WIDTH, "0")}`,
				offset: BigInt(offset),
				size: BigInt(size),
				typeId,
				nameId,
				typeName,
			});
		}
	}
	if (0 === entries.length) return undefined;
	return { shift, entries };
}

export const neDescriptor: FormatDescriptor = {
	id: "microsoft-ne-archive",
	name: "Windows 16 bit executable resources",
	extensions: ["exe"],
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
			source: "Experimental/Microsoft/ArcNE.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const neFormat = defineFixedArchive({
	descriptor: neDescriptor,
	detection: { signatures: [{ bytes: DOS_SIGNATURE }], priority: -2 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(DOS_HEADER_SIZE)) return false;
		const head = await source.readAt(
			0n,
			Math.min(Number(source.size), 0x10000),
		);
		return readNeLayout(head, source.size) !== undefined;
	},
	async read(source: ByteSource) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readNeLayout(data, source.size);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid NE resource table");
		const entries = layout.entries.map((plan) =>
			createFixedEntry({
				id: plan.index,
				...normalizeEntryPath(plan.name),
				offset: plan.offset,
				size: plan.size,
				metadata: {
					type: plan.typeId,
					resourceType: plan.typeName,
					resourceName: plan.nameId,
					...(RT_VERSION === plan.typeId ? { versionResource: true } : {}),
				},
			}),
		);
		return {
			entries,
			metadata: {
				shift: layout.shift,
				entryCount: entries.length,
			},
		};
	},
});
