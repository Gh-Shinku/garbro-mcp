import { GarbroError } from "./errors.js";
import { entryResourceType } from "./resource-type.js";
import type { ArchiveEntry } from "./types.js";

type GroupBy = "directory" | "prefix";
export interface EntryBrowseOptions {
	by?: GroupBy | undefined;
	key?: string | undefined;
	offset?: number | undefined;
}

function groupKey(path: string, by: GroupBy): string {
	const normalized = path.replaceAll("\\", "/");
	const slash = normalized.lastIndexOf("/");
	if (by === "directory") return slash < 0 ? "" : normalized.slice(0, slash);
	const stem = normalized.slice(slash + 1).replace(/\.[^.]+$/, "");
	if (
		/^[0-9a-f]{8,}$/i.test(stem) ||
		/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(stem)
	)
		return "";
	// A token before a separator, or the letters before a sequence number (e.g. bg001).
	return (
		/^(\p{L}[\p{L}\p{N}]*)(?=[_.# -])/u.exec(stem)?.[1] ??
		/^(\p{L}+)(?=[0-9])/u.exec(stem)?.[1] ??
		""
	);
}

export function selectEntryGroup(
	entries: ArchiveEntry[],
	options: EntryBrowseOptions,
) {
	if (options.key === undefined) return entries;
	const by = options.by;
	if (!by)
		throw new GarbroError(
			"INVALID_ARGUMENT",
			"A group key requires directory or prefix grouping",
		);
	return entries.filter((entry) => groupKey(entry.path, by) === options.key);
}

function countGroups(entries: readonly ArchiveEntry[], by: GroupBy) {
	const counts = new Map<string, number>();
	for (const entry of entries) {
		const key = groupKey(entry.path, by);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}

export function entryBrowseOverview(
	entries: readonly ArchiveEntry[],
	options: EntryBrowseOptions,
) {
	const offset = options.offset ?? 0;
	if (!Number.isSafeInteger(offset) || offset < 0)
		throw new GarbroError(
			"INVALID_ARGUMENT",
			"Group offset must be non-negative",
		);
	let by = options.by ?? "directory";
	let counts = new Map<string, number>();
	if (options.key === undefined) {
		counts = countGroups(entries, by);
		if (options.by === undefined && counts.size < 2) {
			by = "prefix";
			counts = countGroups(entries, by);
			if (
				counts.size < 2 ||
				!Array.from(counts).some(([key, n]) => key !== "" && n > 1)
			)
				counts.clear();
		}
	}
	const groups = Array.from(counts)
		.slice(offset, offset + 20)
		.map(([key, count]) => ({
			browse: { by, key },
			count,
		}));
	const last = entries.length - 1;
	const samples = [];
	for (const index of new Set([0, Math.floor(last / 2), last])) {
		const entry = entries[index];
		if (entry)
			samples.push({
				offset: index,
				id: entry.id,
				path: entry.path,
				resourceType: entryResourceType(entry),
			});
	}
	return {
		totalGroups: counts.size,
		groups,
		nextGroupOffset:
			offset + groups.length < counts.size ? offset + groups.length : null,
		samples,
	};
}
