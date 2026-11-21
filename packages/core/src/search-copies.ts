import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import type { Readable } from "node:stream";
import type { FormatRegistry } from "./registry.js";
import { entryResourceType } from "./resource-type.js";
import type { ArchiveHandle } from "./types.js";

async function digest(stream: Readable, signal?: AbortSignal) {
	const hash = createHash("sha256");
	for await (const chunk of stream) {
		signal?.throwIfAborted();
		hash.update(chunk);
	}
	return hash.digest("hex");
}

// Some readers take names or payloads from companion files. Equal primary files
// can represent different resources. Keep both if equivalence cannot be proven.
async function sameArchive(
	left: ArchiveHandle,
	right: ArchiveHandle,
	signal?: AbortSignal,
) {
	if (
		left.format.id !== right.format.id ||
		left.entries.length !== right.entries.length
	)
		return false;
	if (left.identityFromSourceBytes && right.identityFromSourceBytes)
		return true;
	for (const [i, a] of left.entries.entries()) {
		const b = right.entries[i];
		if (
			!b ||
			a.id !== b.id ||
			a.path !== b.path ||
			a.size !== b.size ||
			entryResourceType(a) !== entryResourceType(b) ||
			a.encrypted !== b.encrypted ||
			a.compressed !== b.compressed
		)
			return false;
		if (
			(await digest(await left.openEntry(a.id), signal)) !==
			(await digest(await right.openEntry(b.id), signal))
		)
			return false;
	}
	return true;
}

export async function uniqueSearchHits<
	T extends { absolutePath: string; size: bigint },
>(
	hits: T[],
	earlierFiles: readonly string[],
	registry: FormatRegistry,
	signal?: AbortSignal,
): Promise<T[]> {
	if (hits.length === 0) return [];
	const sizes = new Set(hits.map((hit) => hit.size));
	const candidates = new Map<bigint, string[]>();
	function remember(size: bigint, path: string) {
		const sameSize = candidates.get(size);
		if (sameSize) sameSize.push(path);
		else candidates.set(size, [path]);
	}
	for (const path of earlierFiles) {
		signal?.throwIfAborted();
		const info = await lstat(path, { bigint: true }).catch(() => undefined);
		if (info?.isFile() && sizes.has(info.size)) remember(info.size, path);
	}
	const hashes = new Map<string, string>();
	async function fileDigest(path: string) {
		const cached = hashes.get(path);
		if (cached) return cached;
		const hash = await digest(createReadStream(path, { signal }), signal);
		hashes.set(path, hash);
		return hash;
	}
	const unique: T[] = [];
	for (const hit of hits) {
		let duplicate = false;
		for (const path of candidates.get(hit.size) ?? []) {
			signal?.throwIfAborted();
			let previous: ArchiveHandle | undefined;
			let current: ArchiveHandle | undefined;
			try {
				if ((await fileDigest(path)) !== (await fileDigest(hit.absolutePath)))
					continue;
				previous = await registry.tryOpenArchive(path);
				if (!previous) continue;
				current = await registry.tryOpenArchive(hit.absolutePath);
				if (current && (await sameArchive(previous, current, signal))) {
					duplicate = true;
					break;
				}
			} catch {
				signal?.throwIfAborted();
			} finally {
				await Promise.all([previous?.close(), current?.close()]);
			}
		}
		if (!duplicate) {
			unique.push(hit);
			remember(hit.size, hit.absolutePath);
		}
	}
	return unique;
}
