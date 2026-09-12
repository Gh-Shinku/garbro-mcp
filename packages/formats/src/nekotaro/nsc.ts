// Format reference: GARbro Legacy/Nekotaro/ArcNSC.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { basename, extname } from "node:path";

const SIGNATURE = Buffer.from("NSCF", "ascii");
const FIRST_OFFSET = 4;
const INDEX_OFFSET = 8;
const MAXIMUM_ENTRIES = 0x40000;

export const nscDescriptor: FormatDescriptor = {
	id: "nekotaro-nsc",
	name: "Nekotaro Game System resource archive",
	extensions: [],
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
			source: "Legacy/Nekotaro/ArcNSC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(source: ByteSource): Promise<boolean> {
	if (source.size < BigInt(INDEX_OFFSET)) return false;
	const signature = await source.readAt(0n, SIGNATURE.length);
	if (!signature.equals(SIGNATURE)) return false;
	const previous = BigInt(
		(await source.readAt(BigInt(FIRST_OFFSET), 4)).readUInt32LE(0),
	);
	return previous >= BigInt(INDEX_OFFSET) && previous <= source.size;
}

async function readNsc(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	if (!(await parseHeader(source))) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Nekotaro NSCF layout");
	}
	const baseName = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	let previous = BigInt(
		(await source.readAt(BigInt(FIRST_OFFSET), 4)).readUInt32LE(0),
	);
	for (
		let position = BigInt(INDEX_OFFSET);
		position + 4n <= source.size && entries.length < MAXIMUM_ENTRIES;
		position += 4n
	) {
		const offset = BigInt((await source.readAt(position, 4)).readUInt32LE(0));
		if (offset <= previous || offset > source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Nekotaro NSC offset table is not monotonic",
			);
		}
		const size = offset - previous;
		if (!checkPlacement(previous, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Nekotaro NSC entry points outside the archive",
			);
		}
		entries.push(
			createFixedEntry({
				id: entries.length,
				path: `${baseName}#${String(entries.length).padStart(4, "0")}`,
				offset: previous,
				size,
			}),
		);
		if (offset === source.size) break;
		previous = offset;
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Nekotaro NSC archive is empty");
	}
	return { entries, metadata: { entryCount: entries.length } };
}

export const nscFormat: ArchiveFormat = defineFixedArchive({
	descriptor: nscDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	detect: parseHeader,
	read: readNsc,
});
