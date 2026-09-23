import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { GarbroError } from "./errors.js";
import type { AutomationControl, BatchExtractionResult } from "./automation.js";
import type { WorkspacePolicy } from "./workspace.js";

export interface ArtifactExpectation {
	sha256?: string;
	bytes?: bigint;
}

export interface ArtifactVerification {
	status: "inspected" | "verified" | "mismatch" | "invalid";
	level: "hash" | "structural" | "manifest";
	outputRootId: string;
	relativePath: string;
	absolutePath: string;
	bytes: bigint;
	sha256: string;
	matched: boolean | null;
	format: "wav" | "ogg" | "binary";
	structuralValid: boolean | null;
	metadata: Record<string, string | number>;
	warnings: string[];
}

export type ExtractionVerificationItem =
	| {
			entryId: string;
			entryPath: string;
			status: ArtifactVerification["status"];
			verification: ArtifactVerification;
	  }
	| {
			entryId: string;
			entryPath: string;
			status: "failed";
			error: GarbroError;
	  };

export interface VerifiedExtractionResult extends BatchExtractionResult {
	verification: {
		verified: number;
		mismatched: number;
		invalid: number;
		inspected: number;
		failed: number;
		items: ExtractionVerificationItem[];
	};
}

interface WaveInspection {
	valid: boolean;
	metadata: Record<string, string | number>;
	warnings: string[];
}

async function inspectWave(
	file: Awaited<ReturnType<typeof open>>,
	fileSize: bigint,
): Promise<WaveInspection> {
	if (fileSize > BigInt(Number.MAX_SAFE_INTEGER))
		return {
			valid: false,
			metadata: {},
			warnings: ["WAV is too large for safe random-access validation"],
		};
	const size = Number(fileSize);
	const head = Buffer.alloc(12);
	if ((await file.read(head, 0, head.length, 0)).bytesRead !== head.length)
		return { valid: false, metadata: {}, warnings: ["Truncated WAV header"] };
	const declaredRiffBytes = head.readUInt32LE(4) + 8;
	let offset = 12;
	let format: Buffer | undefined;
	let dataBytes: number | undefined;
	const warnings: string[] = [];
	while (offset + 8 <= size) {
		const chunk = Buffer.alloc(8);
		if ((await file.read(chunk, 0, 8, offset)).bytesRead !== 8) break;
		const id = chunk.toString("ascii", 0, 4);
		const length = chunk.readUInt32LE(4);
		const end = offset + 8 + length;
		if (end > size)
			return {
				valid: false,
				metadata: {},
				warnings: [`WAV chunk ${id} extends past the file`],
			};
		if (id === "fmt " && format === undefined) {
			format = Buffer.alloc(Math.min(length, 40));
			await file.read(format, 0, format.length, offset + 8);
		}
		if (id === "data" && dataBytes === undefined) dataBytes = length;
		offset = end + (length & 1);
	}
	if (declaredRiffBytes !== size)
		warnings.push(
			`RIFF declares ${declaredRiffBytes} bytes but the file has ${size}`,
		);
	if (format === undefined || format.length < 16)
		warnings.push("WAV has no complete fmt chunk");
	if (dataBytes === undefined) warnings.push("WAV has no data chunk");
	const metadata: Record<string, string | number> = {
		declaredRiffBytes,
		...(dataBytes === undefined ? {} : { dataBytes }),
	};
	if (format !== undefined && format.length >= 16) {
		const codec = format.readUInt16LE(0);
		const channels = format.readUInt16LE(2);
		const sampleRate = format.readUInt32LE(4);
		const byteRate = format.readUInt32LE(8);
		const blockAlign = format.readUInt16LE(12);
		const bitsPerSample = format.readUInt16LE(14);
		Object.assign(metadata, {
			codec,
			channels,
			sampleRate,
			byteRate,
			blockAlign,
			bitsPerSample,
			...(dataBytes === undefined || byteRate === 0
				? {}
				: { durationSeconds: dataBytes / byteRate }),
		});
		if (
			channels === 0 ||
			sampleRate === 0 ||
			blockAlign === 0 ||
			byteRate === 0
		)
			warnings.push("WAV audio parameters contain zero values");
	}
	return { valid: warnings.length === 0, metadata, warnings };
}

export async function verifyArtifact(
	workspace: WorkspacePolicy,
	reference: { outputRootId?: string; path: string },
	expected: ArtifactExpectation = {},
	signal?: AbortSignal,
): Promise<ArtifactVerification> {
	if (expected.sha256 !== undefined && !/^[0-9a-f]{64}$/i.test(expected.sha256))
		throw new GarbroError("INVALID_ARGUMENT", "Expected SHA-256 is invalid");
	if (expected.bytes !== undefined && expected.bytes < 0n)
		throw new GarbroError("INVALID_ARGUMENT", "Expected byte count is invalid");
	const resolved = await workspace.resolveOutputArtifact(
		reference.path,
		reference.outputRootId,
	);
	const file = await open(
		resolved.absolutePath,
		constants.O_RDONLY | constants.O_NOFOLLOW,
	);
	try {
		const info = await file.stat();
		if (!info.isFile())
			throw new GarbroError("UNSAFE_PATH", "Artifact is not a regular file");
		const hash = createHash("sha256");
		let bytes = 0n;
		let prefix = Buffer.alloc(0);
		for await (const value of file.createReadStream({ autoClose: false })) {
			if (signal?.aborted)
				throw new GarbroError("CANCELLED", "Verification was cancelled", {
					cause: signal.reason,
				});
			const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
			hash.update(chunk);
			bytes += BigInt(chunk.length);
			if (prefix.length < 12)
				prefix = Buffer.concat([prefix, chunk.subarray(0, 12 - prefix.length)]);
		}
		const sha256 = hash.digest("hex");
		let format: ArtifactVerification["format"] = "binary";
		let structuralValid: boolean | null = null;
		let metadata: Record<string, string | number> = {};
		let warnings: string[] = [];
		if (
			prefix.length >= 12 &&
			prefix.toString("ascii", 0, 4) === "RIFF" &&
			prefix.toString("ascii", 8, 12) === "WAVE"
		) {
			format = "wav";
			const inspected = await inspectWave(file, bytes);
			structuralValid = inspected.valid;
			metadata = inspected.metadata;
			warnings = inspected.warnings;
		} else if (
			prefix.length >= 4 &&
			prefix.toString("ascii", 0, 4) === "OggS"
		) {
			format = "ogg";
			structuralValid = true;
			metadata = { containerVersion: prefix[4] ?? 0 };
		}
		const hasExpected =
			expected.sha256 !== undefined || expected.bytes !== undefined;
		const matched = hasExpected
			? (expected.sha256 === undefined ||
					expected.sha256.toLowerCase() === sha256) &&
				(expected.bytes === undefined || expected.bytes === bytes)
			: null;
		const level = hasExpected
			? "manifest"
			: structuralValid === true
				? "structural"
				: "hash";
		const status =
			structuralValid === false
				? "invalid"
				: matched === false
					? "mismatch"
					: hasExpected || structuralValid === true
						? "verified"
						: "inspected";
		return {
			status,
			level,
			...resolved,
			bytes,
			sha256,
			matched,
			format,
			structuralValid,
			metadata,
			warnings,
		};
	} finally {
		await file.close();
	}
}

/** Reopen and independently verify every artifact produced by an extraction. */
export async function verifyExtractionResult(
	workspace: WorkspacePolicy,
	result: BatchExtractionResult,
	control: AutomationControl = {},
): Promise<VerifiedExtractionResult> {
	const extractedItems = result.items.filter(
		(item) => item.status === "extracted",
	);
	const items: ExtractionVerificationItem[] = [];
	const counts = {
		verified: 0,
		mismatched: 0,
		invalid: 0,
		inspected: 0,
		failed: 0,
	};

	for (const [index, item] of extractedItems.entries()) {
		if (control.signal?.aborted)
			throw new GarbroError("CANCELLED", "Verification was cancelled", {
				cause: control.signal.reason,
			});
		await control.onProgress?.({
			progress: index,
			total: extractedItems.length,
			message: item.entryPath,
		});
		try {
			const verification = await verifyArtifact(
				workspace,
				{
					outputRootId: item.artifact.outputRootId,
					path: item.artifact.relativePath,
				},
				{
					sha256: item.artifact.sha256,
					bytes: item.artifact.bytesWritten,
				},
				control.signal,
			);
			if (verification.status === "mismatch") counts.mismatched += 1;
			else counts[verification.status] += 1;
			items.push({
				entryId: item.entryId,
				entryPath: item.entryPath,
				status: verification.status,
				verification,
			});
		} catch (error) {
			if (control.signal?.aborted) throw error;
			counts.failed += 1;
			items.push({
				entryId: item.entryId,
				entryPath: item.entryPath,
				status: "failed",
				error: asVerificationError(error),
			});
		}
	}

	await control.onProgress?.({
		progress: extractedItems.length,
		total: extractedItems.length,
	});
	const verificationFailures =
		counts.mismatched + counts.invalid + counts.failed;
	const totalFailures = result.failed + verificationFailures;
	return {
		...result,
		status:
			totalFailures === 0
				? "completed"
				: result.extracted > 0 || result.skipped > 0
					? "partial"
					: "failed",
		hasFailures: totalFailures > 0,
		verification: { ...counts, items },
	};
}

function asVerificationError(error: unknown): GarbroError {
	if (error instanceof GarbroError) return error;
	return new GarbroError(
		"IO_ERROR",
		error instanceof Error ? error.message : String(error),
		{ cause: error },
	);
}
