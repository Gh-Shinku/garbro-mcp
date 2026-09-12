import {
	bigintToBufferLength,
	GarbroError,
	type ByteSource,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { decompressAcpLzw } from "./acp-lzw.js";

const ACP_ENTRY_SIGNATURE = Buffer.from([0x61, 0x63, 0x70, 0x00]);

export interface AcpStoredEntry {
	offset: bigint;
	size: bigint;
	packedSize: bigint;
	compressed: boolean;
}

export async function inspectAcpEntry(
	source: ByteSource,
	offset: bigint,
	packedSize: bigint,
	path: string,
): Promise<{ size: bigint; compressed: boolean }> {
	if (packedSize <= 8n) return { size: packedSize, compressed: false };
	const header = await source.readAt(offset, 8);
	if (!header.subarray(0, 4).equals(ACP_ENTRY_SIGNATURE)) {
		return { size: packedSize, compressed: false };
	}
	const unpackedSize = header.readInt32BE(4);
	if (unpackedSize < 0) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`ACP entry has an invalid output size: ${path}`,
		);
	}
	return { size: BigInt(unpackedSize), compressed: true };
}

export async function openAcpEntry(
	source: ByteSource,
	entry: AcpStoredEntry,
): Promise<Readable> {
	if (!entry.compressed) {
		return source.createReadStream(entry.offset, entry.packedSize);
	}
	const packed = await source.readAt(
		entry.offset + 8n,
		bigintToBufferLength(entry.packedSize - 8n, "ACP LZW entry"),
	);
	return Readable.from([
		decompressAcpLzw(
			packed,
			bigintToBufferLength(entry.size, "ACP LZW output"),
		),
	]);
}
