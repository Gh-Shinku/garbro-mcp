// Port of GARbro "Experimental/Microsoft/ArcEXE.cs" (tag "EXE", class ExeOpener), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. The resources of a Windows executable, listed as
// the files of an archive.
//
// The reference stands of the resource table of a portable executable (`ExeFile.ResourceAccessor`) and of
// its own two tables of names: the numbered kinds of resources the engine's own names for them
// (`RuntimeTypeMap`), and the extension of a file of every kind of resource (`ExtensionTypeMap`). A kind
// that stands of a number the reference holds no name for is left out of the listing; every other kind
// stands of a directory of its own, of the name of the resource behind the kind and of the extension of the
// kind. A numbered resource of the kind `#16` (the version of the file) stands of a text of the reference's
// own walk (`OpenVersion`), and a resource of the kind `#2` (a picture) stands of a bitmap head the
// reference puts in front of it (`OpenImage`).
//
// This project already carries a reader of the resources of a portable executable (`shared/exe.ts`), so the
// walk here stands of it rather than of a second reader. The places of the files of the listing stand at
// nought, as the reference itself writes them (`entry.Offset = 0; // bogus XXX`): the places of a resource
// stand in no single run of the file, so every file stands of a second look at the resource table of the
// executable where its places are asked for.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	findExecutableResource,
	readExecutableResources,
} from "../shared/exe.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const BASELINE_COMMIT = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";

/** `ExeOpener.RuntimeTypeMap`: the names of the kinds of resource that stand of a number. */
export const EXECUTABLE_RUNTIME_TYPE_MAP: Record<string, string> = {
	"#2": "RT_BITMAP",
	"#10": "RT_RCDATA",
	"#16": "RT_VERSION",
};

/** `ExeOpener.ExtensionTypeMap`: the extension of a file of every kind of resource. */
export const EXECUTABLE_EXTENSION_TYPE_MAP: Record<string, string> = {
	PNG: ".PNG",
	WAVE: ".WAV",
	MIDS: ".MID",
	SCR: ".BIN",
	"#2": ".BMP",
	"#10": ".BIN",
};

/** The kind of a resource that stands of a picture of the file. */
const BITMAP_TYPE = "#2";

/** The places of the head of a bitmap of the reference: the head of the file, then the head of the picture. */
const BMP_HEAD_PLACES = 14;
/** Where the count of the places of the picture stands in the head of a bitmap. */
const BMP_IMAGE_COUNT_AT = 0x22;
const BMP_INFO_COUNT_AT = 14;
/** `ExeOpener.ResourcesArchive`: the resource of an executable stands of a second look at its table. */
async function resourceOf(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Buffer | undefined> {
	const data = Buffer.from(await source.readAt(0n, Number(source.size)));
	const type = entry.metadata?.nativeType;
	const name = entry.metadata?.nativeName;
	if ("string" !== typeof type && "number" !== typeof type) return undefined;
	if ("string" !== typeof name && "number" !== typeof name) return undefined;
	return findExecutableResource(data, { type, name });
}

/**
 * The label of a resource as the reference writes one: its own `ResourceNameToString` writes a numbered
 * entry as `#` and the number, and a name as it stands.
 */
function resourceLabel(label: string | number): string {
	return "number" === typeof label ? `#${label}` : label;
}

/** `ExeOpener.IdToString`: a numbered resource of the engine stands of a count of five places. */
export function executableResourceId(id: string): string {
	if (id.length > 1 && "#" === id[0] && /[0-9]/.test(id[1] ?? "")) {
		return id.slice(1).padStart(5, "0");
	}
	return id;
}

/** `ExeOpener.OpenImage`: the places of a picture of an executable, of a bitmap head. */
export function wrapExecutableBitmap(resource: Buffer): Buffer {
	const bitmap = Buffer.alloc(BMP_HEAD_PLACES + resource.length, 0x00);
	resource.copy(bitmap, BMP_HEAD_PLACES);
	bitmap.write("BM", 0, "latin1");
	bitmap.writeUInt32LE(bitmap.length, 2);
	// The reference reads the counts of the head of the picture as they stand and stands of the head of the
	// picture itself where the counts of the places of it stand at nought; a resource too short to hold
	// those counts stands of the whole of the file, which is what the reference would come to as well.
	const bitsLength =
		BMP_IMAGE_COUNT_AT + 4 <= bitmap.length
			? bitmap.readInt32LE(BMP_IMAGE_COUNT_AT)
			: 0;
	const infoLength =
		BMP_INFO_COUNT_AT + 4 <= bitmap.length
			? bitmap.readInt32LE(BMP_INFO_COUNT_AT)
			: 0;
	const bitsAt =
		0 === bitsLength
			? infoLength + BMP_HEAD_PLACES
			: bitmap.length - bitsLength;
	bitmap.writeUInt32LE(bitsAt >>> 0, 10);
	return bitmap;
}

export const executableResourcesDescriptor: FormatDescriptor = {
	id: "executable-resources",
	name: "Windows executable resources",
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
			source: "Experimental/Microsoft/ArcEXE.cs",
			license: "MIT",
			commit: BASELINE_COMMIT,
		},
	],
};

/** `ExeOpener.TryOpen`: the resources of an executable, of its own two tables of names. */
export function executableResourceEntries(
	data: Buffer,
): FixedEntry[] | undefined {
	if (data.length < 2 || "MZ" !== data.toString("latin1", 0, 2))
		return undefined;
	const resources = readExecutableResources(data);
	if (!resources) return undefined;
	const entries: FixedEntry[] = [];
	for (const resource of resources) {
		const type = resourceLabel(resource.type);
		if (
			type.startsWith("#") &&
			undefined === EXECUTABLE_RUNTIME_TYPE_MAP[type]
		) {
			continue;
		}
		const directory = EXECUTABLE_RUNTIME_TYPE_MAP[type] ?? type;
		const extension = EXECUTABLE_EXTENSION_TYPE_MAP[type] ?? "";
		const name = resourceLabel(resource.name);
		const file = name.startsWith("#") ? executableResourceId(name) : name;
		entries.push({
			...createFixedEntry({
				id: entries.length,
				path: `${directory}/${file}${extension}`,
				offset: 0n,
				size: BigInt(resource.data.length),
				compressed: false,
				metadata: {
					nativeType: resource.type,
					nativeName: resource.name,
					language: resource.language,
				} as Record<string, unknown>,
			}),
			sizeKnown: true,
		});
	}
	return 0 === entries.length ? undefined : entries;
}

export const executableResourcesEntryOpener: FixedEntryOpener = async (
	source,
	entry,
) => {
	const resource = await resourceOf(source, entry);
	if (!resource) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"The resource of this file stands in no table of the executable it was read of",
		);
	}
	const native = entry.metadata?.nativeType;
	const type =
		"string" === typeof native || "number" === typeof native
			? resourceLabel(native)
			: "";
	if (BITMAP_TYPE === type)
		return Readable.from([wrapExecutableBitmap(resource)]);
	return Readable.from([Buffer.from(resource)]);
};

export const executableResourcesFormat: ArchiveFormat = defineFixedArchive({
	descriptor: executableResourcesDescriptor,
	detection: {
		signatures: [{ bytes: Buffer.from("MZ", "latin1") }],
		priority: -1,
	},
	async detect(source: ByteSource): Promise<boolean> {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		return executableResourceEntries(data) !== undefined;
	},
	async read(source: ByteSource) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const entries = executableResourceEntries(data);
		if (!entries) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Not a Windows executable, or one whose resources stand of no walk of this port",
			);
		}
		return { entries, metadata: { count: entries.length } };
	},
	openEntry: executableResourcesEntryOpener,
});
