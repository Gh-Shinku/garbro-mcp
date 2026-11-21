import { GarbroError } from "@garbro-mcp/core";
import { MAX_RESPONSE_BYTES, toolResult } from "./context.js";
import type { directoryDiagnostics } from "./diagnostics.js";

export const DEFAULT_SEARCH_BYTES = 4096;
export const MIN_SEARCH_BYTES = 2048;

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
) {
	const rows: Row[] = [];
	let matchedTotal = 0;
	for (const { entries, ...archive } of input.archives) {
		matchedTotal += archive.matchedTotal;
		for (const sample of entries) rows.push({ archive, sample });
	}
	const sampleCount = rows.length;
	for (const diagnostic of input.diagnostics) rows.push({ diagnostic });
	for (const failure of input.failures) rows.push({ failure });
	return {
		maxResponseBytes,
		rows,
		summary: {
			scanned: input.scanned,
			complete: input.complete,
			nextCursor: input.nextCursor,
			matchedTotal,
			archiveCount: input.archives.length,
			sampleCount,
			diagnosticGroupCount: input.diagnostics.length,
			failureCount: input.failures.length,
		},
	};
}

export type SearchSnapshot = ReturnType<typeof searchSnapshot>;
export interface SearchReadOptions {
	resultCursor?: string | undefined;
	limit?: number | undefined;
	maxResponseBytes?: number | undefined;
}

export function mirroredResult(payload: Record<string, unknown>) {
	return toolResult(payload, JSON.stringify(payload));
}

// Include the stdio JSON-RPC envelope and leave room for SDK-added protocol
// metadata. Reserving a usual ID width also keeps retries stable across IDs.
export function searchBodyBudget(bytes: number, requestId: number | string) {
	return (
		bytes - 256 - Math.max(20, Buffer.byteLength(JSON.stringify(requestId)))
	);
}

export function searchResultPage(
	taskId: string,
	header: Record<string, unknown>,
	snapshot: SearchSnapshot,
	options: SearchReadOptions,
	budget: number,
) {
	const prefix = `result:${taskId}:`;
	const { rows, summary } = snapshot;
	let start = 0;
	if (options.resultCursor !== undefined) {
		const suffix = options.resultCursor.slice(prefix.length);
		start = Number(suffix);
		if (
			!options.resultCursor.startsWith(prefix) ||
			!/^[1-9]\d*$/.test(suffix) ||
			!Number.isSafeInteger(start) ||
			start >= rows.length
		)
			throw new GarbroError(
				"INVALID_ARGUMENT",
				"Invalid resultCursor for this search task",
			);
	}
	const end = Math.min(rows.length, start + (options.limit ?? rows.length));
	function render(count: number, pageHeader = header) {
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
		const next = start + count;
		const result = {
			...summary,
			archives,
			diagnostics,
			failures,
			resultCursor: next < rows.length ? prefix + next : null,
		};
		const response = mirroredResult({ ...pageHeader, result });
		return Buffer.byteLength(JSON.stringify(response)) <= budget
			? response
			: undefined;
	}
	// Probe small prefixes first so a request for one page never serializes
	// all saved results just to discard the tail.
	const available = end - start;
	let low = 0;
	let high = Math.min(1, available);
	let best: ReturnType<typeof mirroredResult> | undefined;
	while (true) {
		const response = render(high);
		if (!response) break;
		best = response;
		if (high === available) return best;
		low = high;
		high = Math.min(high * 2, available);
	}
	while (high - low > 1) {
		const middle = Math.floor((high + low) / 2);
		const response = render(middle);
		if (response) {
			best = response;
			low = middle;
		} else high = middle;
	}
	if (best) {
		// When the first response is split, spend it on selectable samples.
		// Diagnostic details can be requested with the same cursor mechanism.
		if (start === 0 && summary.sampleCount > 0 && low > summary.sampleCount)
			return render(summary.sampleCount) ?? best;
		return best;
	}
	// Timestamps and progress are optional on a saved result. Keep the
	// complete first sample if it fits with the essential task fields.
	const compact = render(Math.min(1, available), {
		taskId,
		type: "search",
		state: header.state,
		revision: header.revision,
		waitOutcome: header.waitOutcome,
		outcome: header.outcome,
	});
	if (compact) return compact;
	throw new GarbroError(
		"LIMIT_EXCEEDED",
		`Search result cannot fit this page. Retry get_task with a larger maxResponseBytes (maximum ${MAX_RESPONSE_BYTES}).`,
		{
			details: {
				taskId,
				...(options.resultCursor && { resultCursor: options.resultCursor }),
			},
		},
	);
}
