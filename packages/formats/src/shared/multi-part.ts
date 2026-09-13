// Shared helper for GARbro formats that present several files as one virtual archive.
// GARbro reference: ArcFormats/MultiFileArchive.cs, method `OpenStream`.

import type { ByteSource } from "@garbro-mcp/core";
import { Readable } from "node:stream";

/**
 * Streams a virtual byte range that may span several concatenated sources, mirroring
 * `MultiFileArchive.OpenStream`: the sources are laid out one after another and a range is read from the
 * first source whose end lies beyond it, then from each following source until the range is covered.
 *
 * The range is assumed to fit the concatenated sources; a range that reaches past the last source yields
 * only the bytes that exist, which is what the reference does when it falls out of its loop.
 */
export function openMultiPartStream(
	sources: readonly ByteSource[],
	offset: bigint,
	length: bigint,
): Readable {
	return Readable.from(
		(async function* () {
			let partStart = 0n;
			let position = offset;
			let remaining = length;
			for (const source of sources) {
				const partEnd = partStart + source.size;
				if (remaining > 0n && position < partEnd) {
					const available = partEnd - position;
					const take = available < remaining ? available : remaining;
					for await (const chunk of source.createReadStream(
						position - partStart,
						take,
					))
						yield chunk;
					position += take;
					remaining -= take;
				}
				partStart = partEnd;
				if (remaining <= 0n) return;
			}
		})(),
	);
}
