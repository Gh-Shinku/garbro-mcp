// Format reference: GARbro ArcFormats/Escude/ArcBIN.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	BufferCursor,
	GarbroError,
	type ArchiveEntry,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inspectAcpEntry, openAcpEntry } from "../favorite/acp-entry.js";
import type { Readable } from "node:stream";

const ESCUDE_V1_SIGNATURE = Buffer.from("ESC-ARC1", "ascii");
const ESCUDE_V2_SIGNATURE = Buffer.from("ESC-ARC2", "ascii");
const MAX_ENTRY_COUNT = 0xfffff;

interface EscudeEntry extends ArchiveEntry {
	offset: bigint;
}

interface EscudeDirectory {
	entries: EscudeEntry[];
	version: 1 | 2;
}

export const escudeBinDescriptor: FormatDescriptor = {
	id: "escude-bin",
	name: "Escu:de ESC-ARC resource archive",
	extensions: ["bin"],
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
			source: "ArcFormats/Escude/ArcBIN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/Favorite/ArcFVP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

class EscudeKeyGenerator {
	#seed: number;

	constructor(seed: number) {
		this.#seed = seed >>> 0;
	}

	next(): number {
		this.#seed = (this.#seed ^ 0x65ac9365) >>> 0;
		const right = (((this.#seed >>> 1) ^ this.#seed) >>> 3) >>> 0;
		const left = ((((this.#seed << 1) ^ this.#seed) << 3) >>> 0) >>> 0;
		this.#seed = (this.#seed ^ right ^ left) >>> 0;
		return this.#seed;
	}
}

function decryptWords(data: Buffer, keys: EscudeKeyGenerator): void {
	for (let offset = 0; offset < data.length; offset += 4) {
		data.writeUInt32LE((data.readUInt32LE(offset) ^ keys.next()) >>> 0, offset);
	}
}

async function makeEntry(
	source: ByteSource,
	id: number,
	rawPath: string,
	offset: bigint,
	packedSize: bigint,
): Promise<EscudeEntry> {
	if (!rawPath) {
		throw new GarbroError("INVALID_ARCHIVE", "ESC-ARC entry has an empty name");
	}
	if (offset > source.size || packedSize > source.size - offset) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`ESC-ARC entry points outside the archive: ${rawPath}`,
		);
	}
	const { size, compressed } = await inspectAcpEntry(
		source,
		offset,
		packedSize,
		rawPath,
	);
	return {
		id: String(id),
		path: rawPath.replaceAll("\\", "/"),
		...(rawPath.includes("\\") ? { rawPath } : {}),
		size,
		packedSize,
		compressed,
		encrypted: false,
		offset,
	};
}

async function readDirectory(source: ByteSource): Promise<EscudeDirectory> {
	if (source.size < 0x10n) {
		throw new GarbroError("INVALID_ARCHIVE", "ESC-ARC header is truncated");
	}
	const header = await source.readAt(0n, source.size < 0x14n ? 0x10 : 0x14);
	const version = header.subarray(0, 8).equals(ESCUDE_V1_SIGNATURE)
		? 1
		: header.subarray(0, 8).equals(ESCUDE_V2_SIGNATURE)
			? 2
			: undefined;
	if (version === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid ESC-ARC signature");
	}
	const keys = new EscudeKeyGenerator(header.readUInt32LE(8));
	const count = (header.readUInt32LE(12) ^ keys.next()) >>> 0;
	if (count === 0 || count > MAX_ENTRY_COUNT) {
		throw new GarbroError("INVALID_ARCHIVE", "ESC-ARC entry count is invalid");
	}
	const entries: EscudeEntry[] = [];
	if (version === 1) {
		const indexSize = count * 0x88;
		if (
			!Number.isSafeInteger(indexSize) ||
			BigInt(0x10 + indexSize) > source.size
		) {
			throw new GarbroError("INVALID_ARCHIVE", "ESC-ARC v1 index is truncated");
		}
		const index = await source.readAt(0x10n, indexSize);
		decryptWords(index, keys);
		for (let id = 0; id < count; id += 1) {
			const record = new BufferCursor(
				index.subarray(id * 0x88, (id + 1) * 0x88),
			);
			const rawPath = record.readCString(0x80);
			const offset = BigInt(record.readU32LE());
			const packedSize = BigInt(record.readU32LE());
			entries.push(await makeEntry(source, id, rawPath, offset, packedSize));
		}
	} else {
		if (header.length < 0x14) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"ESC-ARC v2 header is truncated",
			);
		}
		const namesSize = (header.readUInt32LE(0x10) ^ keys.next()) >>> 0;
		const indexSize = count * 12;
		const namesOffset = BigInt(0x14 + indexSize);
		if (
			!Number.isSafeInteger(indexSize) ||
			namesOffset > source.size ||
			BigInt(namesSize) > source.size - namesOffset
		) {
			throw new GarbroError("INVALID_ARCHIVE", "ESC-ARC v2 index is truncated");
		}
		const [index, names] = await Promise.all([
			source.readAt(0x14n, indexSize),
			source.readAt(namesOffset, namesSize),
		]);
		decryptWords(index, keys);
		const records = new BufferCursor(index);
		for (let id = 0; id < count; id += 1) {
			const nameOffset = records.readI32LE();
			const offset = BigInt(records.readU32LE());
			const packedSize = BigInt(records.readU32LE());
			if (nameOffset < 0 || nameOffset >= names.length) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"ESC-ARC filename offset is outside the name table",
				);
			}
			const rawPath = new BufferCursor(names.subarray(nameOffset)).readCString(
				names.length - nameOffset,
			);
			entries.push(await makeEntry(source, id, rawPath, offset, packedSize));
		}
	}
	return { entries, version };
}

class EscudeArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = escudeBinDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly EscudeEntry[];
	readonly #source: ByteSource;

	constructor(
		source: ByteSource,
		sourcePath: string,
		directory: EscudeDirectory,
	) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = directory.entries;
		this.metadata = { version: directory.version };
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry) {
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		}
		return openAcpEntry(this.#source, entry);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export class EscudeBinFormat implements ArchiveFormat {
	readonly descriptor = escudeBinDescriptor;
	readonly detection = {
		signatures: [
			{ bytes: ESCUDE_V1_SIGNATURE },
			{ bytes: ESCUDE_V2_SIGNATURE },
		],
	};

	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < 0x10n) return false;
		const header = await source.readAt(0n, 0x10);
		const signature = header.subarray(0, 8);
		if (
			!signature.equals(ESCUDE_V1_SIGNATURE) &&
			!signature.equals(ESCUDE_V2_SIGNATURE)
		) {
			return false;
		}
		const keys = new EscudeKeyGenerator(header.readUInt32LE(8));
		const count = (header.readUInt32LE(12) ^ keys.next()) >>> 0;
		return count > 0 && count <= MAX_ENTRY_COUNT;
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		return new EscudeArchiveHandle(
			source,
			sourcePath,
			await readDirectory(source),
		);
	}
}
