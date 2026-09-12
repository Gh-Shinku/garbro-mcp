// Format reference: GARbro ArcFormats/Ikura/ArcDRS.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	bigintToBufferLength,
	BufferCursor,
	GarbroError,
	type ArchiveEntry,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { extname } from "node:path";
import { Readable } from "node:stream";

const MPX_SIGNATURE = Buffer.from("SM2MPX10", "ascii");
const SECRET_MARKER = Buffer.from("SECRETFILTER100a", "ascii");
const HEADER_SIZE = 0x20;
const RECORD_SIZE = 0x14;
const NAME_SIZE = 12;
const MAX_ENTRY_COUNT = 0xfffff;
const MAX_ARCHIVE_SIZE = 0xffffffffn;

type ScriptTransform = "rotate-right-2" | "invert" | "xor-key";

interface MpxEntry extends ArchiveEntry {
	offset: bigint;
	scriptTransform?: ScriptTransform;
	secretFiltered: boolean;
}

export const mpxDescriptor: FormatDescriptor = {
	id: "ikura-gdl",
	name: "IKURA GDL resource archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Ikura/ArcDRS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function isScript(path: string): boolean {
	const extension = extname(path);
	return extension === ".isf" || extension === ".snr";
}

async function classifyScript(
	source: ByteSource,
	offset: bigint,
	size: bigint,
): Promise<{
	transform?: ScriptTransform;
	secretFiltered: boolean;
}> {
	if (size <= 0x10n) return { secretFiltered: false };
	const tail = await source.readAt(offset + size - 0x10n, 0x10);
	if (tail.equals(SECRET_MARKER)) return { secretFiltered: true };
	const header = await source.readAt(offset, 8);
	const signature = header.readUInt16LE(4);
	if (signature === 0x9795) {
		return { transform: "rotate-right-2", secretFiltered: false };
	}
	if (signature === 0xd197) {
		return { transform: "invert", secretFiltered: false };
	}
	if (signature === 0xce89 && (header[6] ?? 0) !== 0) {
		return { transform: "xor-key", secretFiltered: false };
	}
	return { secretFiltered: false };
}

async function readEntries(source: ByteSource): Promise<MpxEntry[]> {
	if (source.size > MAX_ARCHIVE_SIZE || source.size < BigInt(HEADER_SIZE)) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"IKURA GDL archive size is invalid",
		);
	}
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, 8).equals(MPX_SIGNATURE)) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid IKURA GDL signature");
	}
	const count = header.readInt32LE(8);
	const declaredIndexSize = header.readUInt32LE(12);
	if (count <= 0 || count > MAX_ENTRY_COUNT) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"IKURA GDL entry count is invalid",
		);
	}
	const indexSize = count * RECORD_SIZE;
	if (
		!Number.isSafeInteger(indexSize) ||
		BigInt(declaredIndexSize) > source.size ||
		BigInt(HEADER_SIZE + indexSize) > source.size
	) {
		throw new GarbroError("INVALID_ARCHIVE", "IKURA GDL index is truncated");
	}
	const index = new BufferCursor(
		await source.readAt(BigInt(HEADER_SIZE), indexSize),
	);
	const entries: MpxEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const rawPath = index.readCString(NAME_SIZE).toLowerCase();
		const offset = BigInt(index.readU32LE());
		const size = BigInt(index.readU32LE());
		if (!rawPath) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"IKURA GDL entry has an empty name",
			);
		}
		if (offset > source.size || size > source.size - offset) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`IKURA GDL entry points outside the archive: ${rawPath}`,
			);
		}
		const script = isScript(rawPath);
		const classification = script
			? await classifyScript(source, offset, size)
			: { secretFiltered: false };
		entries.push({
			id: String(id),
			path: rawPath.replaceAll("\\", "/"),
			...(rawPath.includes("\\") ? { rawPath } : {}),
			size,
			packedSize: size,
			compressed: false,
			encrypted: classification.secretFiltered,
			offset,
			secretFiltered: classification.secretFiltered,
			...(classification.transform
				? {
						scriptTransform: classification.transform,
						metadata: { scriptTransform: classification.transform },
					}
				: classification.secretFiltered
					? { metadata: { requiresSecret: true } }
					: {}),
		});
	}
	return entries;
}

function transformScript(data: Buffer, transform: ScriptTransform): void {
	if (transform === "xor-key") {
		const key = data[6] ?? 0;
		for (let index = 8; index < data.length; index += 1) {
			data[index] = (data[index] ?? 0) ^ key;
		}
		return;
	}
	for (let index = 8; index < data.length; index += 1) {
		const value = data[index] ?? 0;
		data[index] =
			transform === "invert" ? ~value : ((value >>> 2) | (value << 6)) & 0xff;
	}
}

class MpxArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = mpxDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly MpxEntry[];
	readonly #source: ByteSource;

	constructor(source: ByteSource, sourcePath: string, entries: MpxEntry[]) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = entries;
		this.metadata = {
			hasScripts: entries.some((entry) => isScript(entry.path)),
			hasSecretFilteredScripts: entries.some((entry) => entry.secretFiltered),
		};
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry) {
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		}
		if (!entry.scriptTransform || entry.secretFiltered) {
			return this.#source.createReadStream(entry.offset, entry.size);
		}
		const data = await this.#source.readAt(
			entry.offset,
			bigintToBufferLength(entry.size, "IKURA GDL script"),
		);
		transformScript(data, entry.scriptTransform);
		return Readable.from([data]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export class MpxFormat implements ArchiveFormat {
	readonly descriptor = mpxDescriptor;
	readonly detection = { signatures: [{ bytes: MPX_SIGNATURE }] };

	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const header = await source.readAt(0n, HEADER_SIZE);
		const count = header.readInt32LE(8);
		return (
			header.subarray(0, 8).equals(MPX_SIGNATURE) &&
			count > 0 &&
			count <= MAX_ENTRY_COUNT &&
			BigInt(HEADER_SIZE + count * RECORD_SIZE) <= source.size
		);
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		return new MpxArchiveHandle(source, sourcePath, await readEntries(source));
	}
}
