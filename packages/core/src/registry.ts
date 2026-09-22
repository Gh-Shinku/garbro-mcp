import { extname, resolve } from "node:path";
import { GarbroError } from "./errors.js";
import { FileByteSource } from "./source.js";
import type {
	ArchiveFormat,
	ArchiveHandle,
	DetectionResult,
	FormatDescriptor,
} from "./types.js";

export class FormatRegistry {
	readonly #formats: ArchiveFormat[] = [];

	constructor(formats: readonly ArchiveFormat[] = []) {
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

	async detectArchive(inputPath: string): Promise<DetectionResult | undefined> {
		const sourcePath = resolve(inputPath);
		for (const format of await this.#candidateFormats(sourcePath)) {
			const source = await FileByteSource.open(sourcePath);
			let handle: ArchiveHandle | undefined;
			try {
				if (await format.detect(source, sourcePath)) {
					handle = await format.open(source, sourcePath);
					return {
						path: sourcePath,
						size: source.size,
						format: format.descriptor,
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
		for (const format of await this.#candidateFormats(sourcePath)) {
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

	async #candidateFormats(sourcePath: string): Promise<ArchiveFormat[]> {
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
	): Promise<ArchiveFormat[]> {
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
			.filter(({ format, signatureMatch }) => {
				const signatures = format.detection?.signatures;
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
			.map(({ format }) => format);
	}
}

function isInvalidCandidate(error: unknown): boolean {
	return error instanceof GarbroError && error.code === "INVALID_ARCHIVE";
}
