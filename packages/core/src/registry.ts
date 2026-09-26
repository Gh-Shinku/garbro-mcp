import { extname, resolve } from "node:path";
import { GarbroError } from "./errors.js";
import { FileByteSource } from "./source.js";
import type {
	ArchiveFormat,
	ArchiveHandle,
	DetectionResult,
	FormatDescriptor,
} from "./types.js";

interface DetectionCandidate {
	format: ArchiveFormat;
	signatureMatch: boolean;
	extensionMatch: boolean;
	hasSignatures: boolean;
}

export class FormatRegistry {
	readonly #formats: ArchiveFormat[] = [];
	readonly #aliases: ReadonlyMap<string, readonly string[]>;

	constructor(
		formats: readonly ArchiveFormat[] = [],
		options: { aliases?: ReadonlyMap<string, readonly string[]> } = {},
	) {
		this.#aliases = options.aliases ?? new Map<string, readonly string[]>();
		for (const format of formats) this.register(format);
	}

	register(format: ArchiveFormat): void {
		if (
			this.#formats.some(
				(candidate) => candidate.descriptor.id === format.descriptor.id,
			)
		) {
			throw new Error(`Format already registered: ${format.descriptor.id}`);
		}
		for (const signature of format.detection?.signatures ?? []) {
			if (signature.bytes.length === 0) {
				throw new Error(
					`Format signature must not be empty: ${format.descriptor.id}`,
				);
			}
			if ((signature.offset ?? 0n) < 0n) {
				throw new Error(
					`Format signature offset must not be negative: ${format.descriptor.id}`,
				);
			}
		}
		this.#formats.push(format);
	}

	listFormats(): readonly FormatDescriptor[] {
		return this.#formats.map((format) => format.descriptor);
	}

	/**
	 * The formats whose walk stands of the places of a name of the extension named, of the places of the
	 * names the reference stands of a resource of another kind as well (`ResourceAlias`). The formats of
	 * the extension itself stand first.
	 */
	listFormatsForExtension(extension: string): readonly FormatDescriptor[] {
		const normalized = extension.replace(/^\./, "").toLowerCase();
		if (normalized.length === 0) return [];
		const own = this.#formats.filter((format) =>
			format.descriptor.extensions.some(
				(candidate) => candidate.toLowerCase() === normalized,
			),
		);
		const named = this.#aliases.get(normalized) ?? [];
		const aliased = this.#formats.filter(
			(format) => named.includes(format.descriptor.id) && !own.includes(format),
		);
		return [...own, ...aliased].map((format) => format.descriptor);
	}

	async detectArchive(inputPath: string): Promise<DetectionResult | undefined> {
		const sourcePath = resolve(inputPath);
		for (const candidate of await this.#candidateFormats(sourcePath)) {
			const { format } = candidate;
			const source = await FileByteSource.open(sourcePath);
			let handle: ArchiveHandle | undefined;
			try {
				if (await format.detect(source, sourcePath)) {
					handle = await format.open(source, sourcePath);
					return {
						path: sourcePath,
						size: source.size,
						format: format.descriptor,
						validation: "structural",
						...detectionConfidence(candidate),
					};
				}
			} catch (error) {
				if (!isInvalidCandidate(error)) throw error;
			} finally {
				if (handle) await handle.close();
				else await source.close();
			}
		}
		return undefined;
	}

	async openArchive(inputPath: string): Promise<ArchiveHandle> {
		const sourcePath = resolve(inputPath);
		for (const { format } of await this.#candidateFormats(sourcePath)) {
			const source = await FileByteSource.open(sourcePath);
			try {
				if (await format.detect(source, sourcePath))
					return await format.open(source, sourcePath);
				await source.close();
			} catch (error) {
				await source.close();
				if (!isInvalidCandidate(error)) throw error;
			}
		}
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`No supported archive format detected: ${sourcePath}`,
		);
	}

	async #candidateFormats(sourcePath: string): Promise<DetectionCandidate[]> {
		const source = await FileByteSource.open(sourcePath);
		try {
			return await this.#detectionCandidates(source, sourcePath);
		} finally {
			await source.close();
		}
	}

	async #detectionCandidates(
		source: FileByteSource,
		sourcePath: string,
	): Promise<DetectionCandidate[]> {
		const extension = extname(sourcePath).slice(1).toLowerCase();
		const reads = new Map<string, Promise<Buffer>>();
		const signatureMatches = new Set<ArchiveFormat>();

		const readSignature = (offset: bigint, length: number): Promise<Buffer> => {
			const key = `${offset}:${length}`;
			let result = reads.get(key);
			if (!result) {
				result = source.readAt(offset, length);
				reads.set(key, result);
			}
			return result;
		};

		await Promise.all(
			this.#formats.map(async (format) => {
				for (const signature of format.detection?.signatures ?? []) {
					const offset = signature.offset ?? 0n;
					if (
						offset > source.size ||
						BigInt(signature.bytes.length) > source.size - offset
					)
						continue;
					const actual = await readSignature(offset, signature.bytes.length);
					if (actual.equals(signature.bytes)) {
						signatureMatches.add(format);
						break;
					}
				}
			}),
		);

		return this.#formats
			.map((format, registrationOrder) => ({
				format,
				registrationOrder,
				signatureMatch: signatureMatches.has(format),
				extensionMatch: format.descriptor.extensions.some(
					(candidate) => candidate.toLowerCase() === extension,
				),
			}))
			.filter(({ format, signatureMatch, extensionMatch }) => {
				const signatures = format.detection?.signatures;
				if (format.detection?.extensionOnly === true && !extensionMatch)
					return false;
				if (
					format.descriptor.extensions.length > 0 &&
					(!signatures || signatures.length === 0) &&
					!extensionMatch
				)
					return false;
				return (
					signatureMatch ||
					!signatures ||
					signatures.length === 0 ||
					format.detection?.extensionFallback === true
				);
			})
			.sort(
				(left, right) =>
					Number(right.signatureMatch) - Number(left.signatureMatch) ||
					Number(right.extensionMatch) - Number(left.extensionMatch) ||
					(right.format.detection?.priority ?? 0) -
						(left.format.detection?.priority ?? 0) ||
					left.registrationOrder - right.registrationOrder,
			)
			.map(({ format, signatureMatch, extensionMatch }) => ({
				format,
				signatureMatch,
				extensionMatch,
				hasSignatures: (format.detection?.signatures?.length ?? 0) > 0,
			}));
	}
}

function detectionConfidence(candidate: DetectionCandidate): {
	confidence: DetectionResult["confidence"];
	warnings: string[];
} {
	if (candidate.signatureMatch) return { confidence: "high", warnings: [] };
	if (candidate.extensionMatch)
		return {
			confidence: "medium",
			warnings: candidate.hasSignatures
				? [
						"The format signature did not match; detection used an extension fallback.",
					]
				: [],
		};
	return {
		confidence: "low",
		warnings: [
			"Detection used a signatureless format without a matching extension.",
		],
	};
}

function isInvalidCandidate(error: unknown): boolean {
	return error instanceof GarbroError && error.code === "INVALID_ARCHIVE";
}
