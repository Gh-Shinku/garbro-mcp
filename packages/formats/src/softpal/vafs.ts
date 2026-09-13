// Format reference: GARbro "ArcFormats/Softpal/ArcVAFS.cs", class `VafsOpener` (the listing and the
// plain payload extraction; the voice and audio reconstruction in `OpenEntry` is out of scope).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { detectFileType } from "../shared/detect-type.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("VAFS", "latin1");
/** The byte behind the signature is always `H`. */
const HEADER_MARKER_OFFSET = 4;
const HEADER_MARKER = 0x48;
/** The index of the regular layout starts with the first payload offset. */
const INDEX_OFFSET = 0x10;
/** `TP` archives carry a slot table with a fixed stride. */
const TP_INDEX_OFFSET = 0x20;
const TP_SLOT_SIZE = 0x10;
/** The slot walk gives up when it reaches the end of the reserved area. */
const TP_SLOT_LIMIT = 0xa010;
/** One audio chunk is 0x402 bytes wide. */
const TP_CHUNK_SIZE = 0x402;
/** A payload is treated as audio when its size and signature share the chunk scale. */
const WAV_SIZE_THRESHOLD = 0x200;
const WAV_SIZE_SHIFT = 9;
const SIGNATURE_MASK = 0xffff;
/** Short signatures of the Softpal picture formats. */
const PICTURE_SIGNATURES = [1, 3, 4];
/** The extension version from which `TP` archives use the newer layout. */
const TP_VERSION = 54;
const UINT32_MAX = 0xffffffffn;

interface VafsEntry {
	path: string;
	offset: bigint;
	size: bigint;
	type?: string;
	chunkCount?: number;
}

interface VafsLayout {
	entries: VafsEntry[];
	kind: "vafs" | "tp" | "tp055";
}

function baseNameOf(sourcePath: string): string {
	const name = sourcePath.replace(/^.*[/\\]/, "");
	return name.replace(/\.[^.]*$/, "").toUpperCase();
}

/** GARbro `VafsOpener.OpenTpArc` and `OpenTp055Arc`: a slot table of audio offsets. */
async function readTpLayout(
	source: ByteSource,
	version55: boolean,
): Promise<VafsEntry[] | undefined> {
	let indexOffset = TP_INDEX_OFFSET;
	let dataOffset = 0;
	for (;;) {
		if (BigInt(indexOffset) + 4n > source.size) return undefined;
		const head = Buffer.from(await source.readAt(BigInt(indexOffset), 4));
		dataOffset = head.readUInt32LE(0);
		if (dataOffset !== 0) break;
		indexOffset += TP_SLOT_SIZE;
		if (indexOffset === TP_SLOT_LIMIT) return undefined;
	}
	if (BigInt(dataOffset) >= source.size) return undefined;
	const entries: VafsEntry[] = [];
	while (BigInt(indexOffset) < BigInt(dataOffset)) {
		if (BigInt(indexOffset) + 8n > source.size) return undefined;
		const slot = Buffer.from(await source.readAt(BigInt(indexOffset), 8));
		const offset = slot.readUInt32LE(0);
		const field = slot.readInt32LE(4);
		if (offset !== 0) {
			if (version55 && BigInt(offset) >= source.size) return undefined;
			const digits = version55 ? 6 : 5;
			const index = indexOffset / TP_SLOT_SIZE - 1;
			const entry: VafsEntry = {
				path: `TP#${String(index).padStart(digits, "0")}.wav`,
				offset: BigInt(offset),
				size: version55 ? 0n : BigInt((TP_CHUNK_SIZE * (field >>> 0)) >>> 0),
				type: "audio",
				...(version55 ? { chunkCount: field } : {}),
			};
			if (!version55 && !checkPlacement(entry.offset, entry.size, source.size))
				return undefined;
			entries.push(entry);
		}
		indexOffset += TP_SLOT_SIZE;
	}
	if (version55) {
		// The newer layout derives every size from its neighbour, the last one from the file end.
		for (let i = 0; i < entries.length - 1; i += 1) {
			const current = entries[i];
			const next = entries[i + 1];
			if (!current || !next || next.offset < current.offset) return undefined;
			current.size = next.offset - current.offset;
		}
		const last = entries[entries.length - 1];
		if (last) {
			if (last.offset > source.size) return undefined;
			last.size = source.size - last.offset;
		}
		for (const entry of entries)
			if (!checkPlacement(entry.offset, entry.size, source.size))
				return undefined;
	}
	return entries.length > 0 ? entries : undefined;
}

/** GARbro `VafsOpener.TryOpen`: a monotonically growing offset index of generated names. */
async function readVafsLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<VafsLayout | undefined> {
	if (source.size < BigInt(INDEX_OFFSET) + 4n) return undefined;
	const head = Buffer.from(await source.readAt(0n, INDEX_OFFSET + 4));
	if (!head.subarray(0, 4).equals(SIGNATURE)) return undefined;
	if ((head[HEADER_MARKER_OFFSET] ?? 0) !== HEADER_MARKER) return undefined;
	const dataOffset = head.readUInt32LE(INDEX_OFFSET);
	const baseName = baseNameOf(sourcePath);
	if (dataOffset === 0 && baseName === "TP") {
		const extension = sourcePath.replace(/^.*\./, "");
		const version = Number.parseInt(extension, 10);
		const digits = Number.isNaN(version) ? 0 : version;
		const entries = await readTpLayout(source, digits >= TP_VERSION);
		if (!entries) return undefined;
		return { entries, kind: digits >= TP_VERSION ? "tp055" : "tp" };
	}
	if (
		BigInt(dataOffset) < BigInt(INDEX_OFFSET) ||
		BigInt(dataOffset) >= source.size
	)
		return undefined;
	const count = Math.floor((dataOffset - INDEX_OFFSET) / 4);
	if (!isSaneCount(count)) return undefined;
	const isBgm = baseName === "BGM";
	const isPic = baseName === "PIC";
	const entries: VafsEntry[] = [];
	let indexOffset = INDEX_OFFSET;
	let nextOffset = dataOffset;
	for (let i = 0; BigInt(nextOffset) !== source.size && i < count; i += 1) {
		indexOffset += 4;
		const name = `${baseName}#${String(i).padStart(5, "0")}`;
		const offset = nextOffset;
		if (indexOffset === dataOffset) {
			nextOffset = 0;
		} else {
			if (BigInt(indexOffset) + 4n > source.size) return undefined;
			const word = Buffer.from(await source.readAt(BigInt(indexOffset), 4));
			nextOffset = word.readUInt32LE(0);
		}
		if (
			BigInt(nextOffset) === UINT32_MAX ||
			BigInt(nextOffset) < BigInt(offset)
		)
			break;
		const size = BigInt(nextOffset) - BigInt(offset);
		if (size < 4n) continue;
		const entry: VafsEntry = { path: name, offset: BigInt(offset), size };
		if (isPic) {
			entry.type = "image";
		} else if (isBgm) {
			entry.path = `${name}.wav`;
			entry.type = "audio";
		} else {
			const signature = Buffer.from(
				await source.readAt(BigInt(offset), 4),
			).readUInt32LE(0);
			const short = signature & SIGNATURE_MASK;
			if (PICTURE_SIGNATURES.includes(short)) entry.type = "image";
			else if (
				size > BigInt(WAV_SIZE_THRESHOLD) &&
				size >> BigInt(WAV_SIZE_SHIFT) === BigInt(signature >>> WAV_SIZE_SHIFT)
			)
				entry.type = "audio";
			else {
				const detected = detectFileType(signature)?.type;
				if (detected !== undefined) entry.type = detected;
			}
		}
		if (!checkPlacement(entry.offset, entry.size, source.size))
			return undefined;
		entries.push(entry);
	}
	return entries.length > 0 ? { entries, kind: "vafs" } : undefined;
}

export const vafsDescriptor: FormatDescriptor = {
	id: "softpal-vafs",
	name: "Softpal engine resource archive",
	extensions: ["052", "054", "055", "056", "058"],
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
			source: "ArcFormats/Softpal/ArcVAFS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const vafsFormat: ArchiveFormat = defineFixedArchive({
	descriptor: vafsDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readVafsLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readVafsLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Softpal VAFS layout");
		const entries: FixedEntry[] = layout.entries.map((entry, index) =>
			createFixedEntry({
				id: index,
				path: entry.path,
				offset: entry.offset,
				size: entry.size,
				...(entry.type !== undefined || entry.chunkCount !== undefined
					? {
							metadata: {
								...(entry.type !== undefined ? { type: entry.type } : {}),
								...(entry.chunkCount !== undefined
									? { chunkCount: entry.chunkCount }
									: {}),
							} as Record<string, unknown>,
						}
					: {}),
			}),
		);
		return {
			entries,
			metadata: { entryCount: entries.length, layout: layout.kind },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		// Voice and chunked audio reconstruction stays out of scope, so payloads are stored as they are.
		return Readable.from([
			Buffer.from(await source.readAt(entry.offset, Number(entry.size))),
		]);
	},
});
