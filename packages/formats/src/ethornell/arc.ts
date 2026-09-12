// Format reference: GARbro ArcFormats/Ethornell/ArcBGI.cs
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
import { Readable } from "node:stream";
import { decryptBseHeader, decompressDsc } from "./codecs.js";

const BGI_SIGNATURE = Buffer.from("PackFile    ", "ascii");
const BURIKO_SIGNATURE = Buffer.from("BURIKO ARC20", "ascii");
const DSC_SIGNATURE = Buffer.from("DSC FORMAT 1.00\0", "binary");
const HEADER_SIZE = 0x10;
const MAX_ENTRY_COUNT = 0xfffff;

type EntryTransform =
	| { kind: "raw" }
	| { kind: "dsc" }
	| { kind: "bse"; version: number; key: number };

interface BgiEntry extends ArchiveEntry {
	offset: bigint;
	transform: EntryTransform;
}

interface BgiVariant {
	descriptor: FormatDescriptor;
	signature: Buffer;
	recordSize: number;
	nameSize: number;
	offsetPosition: number;
	sizePosition: number;
	bse: boolean;
}

export const bgiArcDescriptor: FormatDescriptor = {
	id: "bgi-arc",
	name: "BGI/Ethornell PackFile archive",
	extensions: ["arc"],
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
			source: "ArcFormats/Ethornell/ArcBGI.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const burikoArcDescriptor: FormatDescriptor = {
	id: "buriko-arc",
	name: "BGI/Ethornell BURIKO ARC20 archive",
	extensions: ["arc"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: bgiArcDescriptor.attribution,
};

const bgiVariant: BgiVariant = {
	descriptor: bgiArcDescriptor,
	signature: BGI_SIGNATURE,
	recordSize: 0x20,
	nameSize: 0x10,
	offsetPosition: 0x10,
	sizePosition: 0x14,
	bse: false,
};

const burikoVariant: BgiVariant = {
	descriptor: burikoArcDescriptor,
	signature: BURIKO_SIGNATURE,
	recordSize: 0x80,
	nameSize: 0x60,
	offsetPosition: 0x60,
	sizePosition: 0x64,
	bse: true,
};

async function classifyEntry(
	source: ByteSource,
	offset: bigint,
	packedSize: bigint,
	bse: boolean,
): Promise<{
	size: bigint;
	compressed: boolean;
	encrypted: boolean;
	transform: EntryTransform;
	inferredType?: string;
}> {
	const probeSize = Number(packedSize < 0x50n ? packedSize : 0x50n);
	const probe =
		probeSize === 0 ? Buffer.alloc(0) : await source.readAt(offset, probeSize);
	if (
		bse &&
		packedSize >= 0x50n &&
		probe.subarray(0, 6).equals(Buffer.from("BSE 1.", "ascii"))
	) {
		const version = probe.readUInt16LE(8);
		if (version === 0x100 || version === 0x101) {
			return {
				size: packedSize - 0x10n,
				compressed: false,
				encrypted: true,
				transform: { kind: "bse", version, key: probe.readUInt32LE(0x0c) },
				inferredType: "image",
			};
		}
	}
	if (packedSize > 0x220n && probe.subarray(0, 16).equals(DSC_SIGNATURE)) {
		const outputSize = probe.readInt32LE(0x14);
		if (outputSize >= 0) {
			return {
				size: BigInt(outputSize),
				compressed: true,
				encrypted: false,
				transform: { kind: "dsc" },
			};
		}
	}
	let inferredType: string | undefined;
	if (probe.subarray(0, 12).equals(Buffer.from("CompressedBG", "ascii"))) {
		inferredType = "image";
	} else if (probe.subarray(4, 8).equals(Buffer.from("bw  ", "ascii"))) {
		inferredType = "audio";
	}
	return {
		size: packedSize,
		compressed: false,
		encrypted: false,
		transform: { kind: "raw" },
		...(inferredType ? { inferredType } : {}),
	};
}

async function readEntries(
	source: ByteSource,
	variant: BgiVariant,
): Promise<BgiEntry[]> {
	if (source.size < BigInt(HEADER_SIZE)) {
		throw new GarbroError("INVALID_ARCHIVE", "BGI archive header is truncated");
	}
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, 12).equals(variant.signature)) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid BGI archive signature");
	}
	const count = header.readInt32LE(12);
	if (count <= 0 || count > MAX_ENTRY_COUNT) {
		throw new GarbroError("INVALID_ARCHIVE", "BGI entry count is invalid");
	}
	const indexSize = count * variant.recordSize;
	const baseOffset = BigInt(HEADER_SIZE + indexSize);
	if (!Number.isSafeInteger(indexSize) || baseOffset > source.size) {
		throw new GarbroError("INVALID_ARCHIVE", "BGI index is truncated");
	}
	const index = await source.readAt(BigInt(HEADER_SIZE), indexSize);
	const entries: BgiEntry[] = [];
	for (
		let position = 0, id = 0;
		id < count;
		id += 1, position += variant.recordSize
	) {
		const record = new BufferCursor(
			index.subarray(position, position + variant.recordSize),
		);
		const rawPath = record.readCString(variant.nameSize);
		if (!rawPath) {
			throw new GarbroError("INVALID_ARCHIVE", "BGI entry has an empty name");
		}
		record.seek(variant.offsetPosition);
		const offset = baseOffset + BigInt(record.readU32LE());
		record.seek(variant.sizePosition);
		const packedSize = BigInt(record.readU32LE());
		if (offset > source.size || packedSize > source.size - offset) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`BGI entry points outside the archive: ${rawPath}`,
			);
		}
		const classification = await classifyEntry(
			source,
			offset,
			packedSize,
			variant.bse,
		);
		entries.push({
			id: String(id),
			path: rawPath.replaceAll("\\", "/"),
			...(rawPath.includes("\\") ? { rawPath } : {}),
			size: classification.size,
			packedSize,
			compressed: classification.compressed,
			encrypted: classification.encrypted,
			offset,
			transform: classification.transform,
			...(classification.inferredType
				? { metadata: { inferredType: classification.inferredType } }
				: {}),
		});
	}
	return entries;
}

class BgiArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format: FormatDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown> = {};
	readonly entries: readonly BgiEntry[];
	readonly #source: ByteSource;

	constructor(
		source: ByteSource,
		sourcePath: string,
		variant: BgiVariant,
		entries: BgiEntry[],
	) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.format = variant.descriptor;
		this.size = source.size;
		this.entries = entries;
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry) {
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		}
		if (entry.transform.kind === "raw") {
			return this.#source.createReadStream(entry.offset, entry.packedSize);
		}
		const input = await this.#source.readAt(
			entry.offset,
			bigintToBufferLength(entry.packedSize, "BGI entry"),
		);
		if (entry.transform.kind === "dsc") {
			return Readable.from([decompressDsc(input)]);
		}
		const header = decryptBseHeader(
			input.subarray(0x10, 0x50),
			entry.transform.version,
			entry.transform.key,
		);
		return Readable.from([header, input.subarray(0x50)]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

class BgiArchiveFormat implements ArchiveFormat {
	readonly descriptor: FormatDescriptor;
	readonly detection: { signatures: Array<{ bytes: Buffer }> };
	readonly #variant: BgiVariant;

	constructor(variant: BgiVariant) {
		this.#variant = variant;
		this.descriptor = variant.descriptor;
		this.detection = { signatures: [{ bytes: variant.signature }] };
	}

	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const header = await source.readAt(0n, HEADER_SIZE);
		const count = header.readInt32LE(12);
		return (
			header.subarray(0, 12).equals(this.#variant.signature) &&
			count > 0 &&
			count <= MAX_ENTRY_COUNT &&
			BigInt(HEADER_SIZE + count * this.#variant.recordSize) <= source.size
		);
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		return new BgiArchiveHandle(
			source,
			sourcePath,
			this.#variant,
			await readEntries(source, this.#variant),
		);
	}
}

export class BgiArcFormat extends BgiArchiveFormat {
	constructor() {
		super(bgiVariant);
	}
}

export class BurikoArcFormat extends BgiArchiveFormat {
	constructor() {
		super(burikoVariant);
	}
}
