import { resolve } from "node:path";
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
		this.#formats.push(format);
	}

	listFormats(): readonly FormatDescriptor[] {
		return this.#formats.map((format) => format.descriptor);
	}

	async detectArchive(inputPath: string): Promise<DetectionResult | undefined> {
		const sourcePath = resolve(inputPath);
		const source = await FileByteSource.open(sourcePath);
		try {
			for (const format of this.#formats) {
				if (await format.detect(source)) {
					return {
						path: sourcePath,
						size: source.size,
						format: format.descriptor,
					};
				}
			}
			return undefined;
		} finally {
			await source.close();
		}
	}

	async openArchive(inputPath: string): Promise<ArchiveHandle> {
		const sourcePath = resolve(inputPath);
		const source = await FileByteSource.open(sourcePath);
		try {
			for (const format of this.#formats) {
				if (await format.detect(source))
					return await format.open(source, sourcePath);
			}
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`No supported archive format detected: ${sourcePath}`,
			);
		} catch (error) {
			await source.close();
			throw error;
		}
	}
}
