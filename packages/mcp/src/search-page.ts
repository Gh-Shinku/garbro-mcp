import type { directoryDiagnostics } from "./diagnostics.js";

import type { SavedResult } from "./result-page.js";

type Source = { path: string };
type Archive = { source: Source; formatId: string; matchedTotal: number };
type Sample = {
	id: string;
	path: string;
	resourceType: string;
	extractSource: {
		source: Source;
		selection: { mode: string; entryIds: string[] };
	};
};
type ArchivePage = Archive & { entries: Sample[] };
type Diagnostic = ReturnType<typeof directoryDiagnostics>[number];
type Failure = { source: Source; error: { code: string; message: string } };
type Row =
	| { archive: Archive; sample: Sample }
	| { diagnostic: Diagnostic }
	| { failure: Failure };

export function searchSnapshot(
	input: {
		scanned: number;
		complete: boolean;
		nextCursor: string | null;
		archives: ArchivePage[];
		diagnostics: Diagnostic[];
		failures: Failure[];
	},
	maxResponseBytes: number,
): SavedResult {
	const rows: Row[] = [];
	let matchedTotal = 0;
	for (const { entries, ...archive } of input.archives) {
		matchedTotal += archive.matchedTotal;
		for (const sample of entries) rows.push({ archive, sample });
	}
	const sampleCount = rows.length;
	for (const diagnostic of input.diagnostics) rows.push({ diagnostic });
	for (const failure of input.failures) rows.push({ failure });
	const summary = {
		scanned: input.scanned,
		complete: input.complete,
		nextCursor: input.nextCursor,
		matchedTotal,
		archiveCount: input.archives.length,
		sampleCount,
		diagnosticGroupCount: input.diagnostics.length,
		failureCount: input.failures.length,
	};
	return {
		maxResponseBytes,
		recordCount: rows.length,
		firstPagePriorityCount: sampleCount,
		compose(start, count) {
			const archives: ArchivePage[] = [];
			const diagnostics: Diagnostic[] = [];
			const failures: Failure[] = [];
			for (const row of rows.slice(start, start + count)) {
				if ("archive" in row) {
					let current = archives.at(-1);
					if (current?.source !== row.archive.source) {
						current = { ...row.archive, entries: [] };
						archives.push(current);
					}
					current.entries.push(row.sample);
				} else if ("diagnostic" in row) diagnostics.push(row.diagnostic);
				else failures.push(row.failure);
			}
			return { ...summary, archives, diagnostics, failures };
		},
	};
}
