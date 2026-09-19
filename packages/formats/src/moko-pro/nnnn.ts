// Format reference: GARbro ArcFormats/MokoPro/CompressedFile.cs, classes `MokoCrypt` and `NNNNOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { MOKO_SIGNATURE, readMokoHeader, unpackMoko } from "./moko-core.js";

/** The single entry of the container: the whole file, named by the name of the file itself. */
function toFixedEntries(
	size: number,
	packedSize: bigint,
	sourcePath: string,
): FixedEntry[] {
	return [
		createFixedEntry({
			id: 0,
			path: basename(sourcePath),
			offset: 0n,
			size: BigInt(size),
			packedSize,
			compressed: true,
			encrypted: true,
			metadata: { type: "data" },
		}),
	];
}

/**
 * GARbro `NNNNOpener.OpenEntry` runs the whole file through `MokoCrypt` and decodes the result as an LZSS
 * stream, so the port decrypts a copy of the payload and unpacks it with a space filled ring buffer.
 */
async function openNnnnEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const stored = Buffer.from(
		await source.readAt(entry.offset, Number(entry.packedSize)),
	);
	return Readable.from([unpackMoko(stored, Number(entry.size))]);
}

export const mokoProNnnnDescriptor: FormatDescriptor = {
	id: "mokopro-nnnn",
	name: "Mokopro compressed file",
	extensions: ["dat"],
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
			source: "ArcFormats/MokoPro/CompressedFile.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mokoProNnnnFormat = defineFixedArchive({
	descriptor: mokoProNnnnDescriptor,
	detection: { signatures: [{ bytes: MOKO_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readMokoHeader(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const unpackedSize = await readMokoHeader(source);
		if (unpackedSize === undefined)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Mokopro layout");
		return {
			entries: toFixedEntries(unpackedSize, source.size, sourcePath),
			metadata: { entryCount: 1 },
		};
	},
	openEntry: openNnnnEntry,
});
