import type {
	ArchiveEntry,
	DetectionResult,
	FormatDescriptor,
} from "./types.js";

export function formatToWire(
	format: FormatDescriptor,
): Record<string, unknown> {
	return {
		id: format.id,
		name: format.name,
		extensions: [...format.extensions],
		capabilities: format.capabilities,
		attribution: format.attribution,
	};
}

export function entryToWire(entry: ArchiveEntry): Record<string, unknown> {
	return {
		id: entry.id,
		path: entry.path,
		...(entry.rawPath === undefined ? {} : { rawPath: entry.rawPath }),
		size: entry.size.toString(),
		...(entry.sizeKnown === undefined ? {} : { sizeKnown: entry.sizeKnown }),
		packedSize: entry.packedSize.toString(),
		compressed: entry.compressed,
		encrypted: entry.encrypted,
		...(entry.checksum === undefined ? {} : { checksum: entry.checksum }),
		...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
	};
}

export function detectionToWire(
	result: DetectionResult,
): Record<string, unknown> {
	return {
		detected: true,
		path: result.path,
		size: result.size.toString(),
		format: formatToWire(result.format),
	};
}
