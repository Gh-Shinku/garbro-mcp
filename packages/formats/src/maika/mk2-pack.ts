// Shared payload handling for GARbro's MAIKA `Mk2Opener` family (ArcMK2.cs), used by the DAT/MK2 and
// DAT/MIK01 ports.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll, inflateMaikaBpr } from "@garbro-mcp/codecs";
import { type ByteSource, bigintToBufferLength } from "@garbro-mcp/core";
import { Readable } from "node:stream";
import type { FixedEntry } from "../shared/fixed-archive.js";

/** GARbro `ScrambleScheme`: a scrambled prefix length and the byte swaps that restore it. */
export interface ScrambleScheme {
	size: number;
	pairs: readonly (readonly [number, number])[];
}

/** GARbro `Mk2Opener.DefaultScheme`. */
export const DEFAULT_SCHEME: ScrambleScheme = {
	size: 14,
	pairs: [
		[7, 11],
		[9, 12],
	],
};

/** GARbro `Mk2Opener.ArScheme`, used by the `AR2.0` and `USG01` archive ids. */
export const AR_SCHEME: ScrambleScheme = {
	size: 15,
	pairs: [
		[7, 13],
		[9, 14],
	],
};

export type ScrambleSchemeId = "default" | "ar";

/** GARbro `Mk2Opener.KnownSchemes`: archive ids that use the larger scramble scheme. */
export function schemeForArchiveId(archiveId: string): ScrambleScheme {
	return archiveId === "AR2.0" || archiveId === "USG01"
		? AR_SCHEME
		: DEFAULT_SCHEME;
}

export function schemeIdOf(scheme: ScrambleScheme): ScrambleSchemeId {
	return scheme === AR_SCHEME ? "ar" : "default";
}

/** GARbro `Mk2Opener.OpenEntry`: the packed header is a two byte signature and a 32-bit size. */
export const PACKED_HEADER_SIZE = 10;
/** 'C1', 'D1', 'E1' and 'F1' mark the archived and scrambled payload forms. */
export const PACKED_SIGNATURES = new Set([0x3143, 0x3144, 0x3145, 0x3146]);
/** Only 'E1' payloads carry a scrambled prefix. */
export const E1_SIGNATURE = 0x3145;
const BPR01 = Buffer.from("BPR01");
const BPR02 = Buffer.from("BPR02");

export interface Mk2Entry extends FixedEntry {
	metadata?: {
		compressionSignature?: number;
		innerPackedSize?: number;
		scrambleScheme?: ScrambleSchemeId;
	};
}

export interface CompressionProbe {
	signature: number;
	innerPackedSize: number;
}

/**
 * Reads an entry's packed header the way GARbro's `OpenEntry` does before it decides how to decode it:
 * a 'C1', 'D1', 'E1' or 'F1' signature, and an inner packed size that neither falls below the scheme's
 * scrambled prefix nor reaches past the end of the record. Anything else is a stored payload.
 */
export async function probeCompression(
	source: ByteSource,
	offset: bigint,
	storedSize: bigint,
	scheme: ScrambleScheme,
): Promise<CompressionProbe | undefined> {
	if (storedSize < BigInt(PACKED_HEADER_SIZE + scheme.size)) return undefined;
	const header = await source.readAt(offset, 6).catch(() => undefined);
	if (!header) return undefined;
	const signature = header.readUInt16LE(0);
	const candidateSize = header.readUInt32LE(2);
	if (!PACKED_SIGNATURES.has(signature)) return undefined;
	if (
		BigInt(candidateSize) > storedSize - BigInt(PACKED_HEADER_SIZE) ||
		candidateSize < scheme.size
	)
		return undefined;
	return { signature, innerPackedSize: candidateSize };
}

/** GARbro's in-place `ScrambleMap` swap loop. */
export function restorePrefix(input: Buffer, scheme: ScrambleScheme): void {
	for (const [left, right] of scheme.pairs) {
		const value = input[left] ?? 0;
		input[left] = input[right] ?? 0;
		input[right] = value;
	}
}

/**
 * GARbro `Mk2Opener.OpenEntry`. A payload whose signature and inner size pass the packed header probe is
 * descrambled when it is an 'E1' entry, run through GARbro's default LZSS variant, and then expanded
 * through the `BPR01` or `BPR02` codec when the LZSS output starts with either marker; a different
 * marker is returned together with the rest of the decoded bytes. Everything else is stored as it is.
 *
 * LZSS runs to the end of the packed range, so a compressed entry's output size is only known once it
 * has been decoded.
 */
export async function openMk2Entry(
	source: ByteSource,
	entry: Mk2Entry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const innerPackedSize = entry.metadata?.innerPackedSize;
	const compressionSignature = entry.metadata?.compressionSignature;
	if (innerPackedSize === undefined || compressionSignature === undefined)
		return source.createReadStream(entry.offset, entry.packedSize);
	const input = Buffer.from(
		await source.readAt(
			entry.offset + BigInt(PACKED_HEADER_SIZE),
			bigintToBufferLength(BigInt(innerPackedSize), "MAIKA packed entry"),
		),
	);
	if (compressionSignature === E1_SIGNATURE) {
		const scheme =
			entry.metadata?.scrambleScheme === "ar" ? AR_SCHEME : DEFAULT_SCHEME;
		restorePrefix(input, scheme);
	}
	const unpacked = inflateLzssAll(input);
	if (unpacked.subarray(0, BPR02.length).equals(BPR02))
		return Readable.from([inflateMaikaBpr(unpacked.subarray(BPR02.length), 3)]);
	if (unpacked.subarray(0, BPR01.length).equals(BPR01))
		return Readable.from([inflateMaikaBpr(unpacked.subarray(BPR01.length), 1)]);
	return Readable.from([unpacked]);
}
