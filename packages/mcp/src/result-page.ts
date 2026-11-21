import { GarbroError } from "@garbro-mcp/core";
import { MAX_RESPONSE_BYTES, toolResult } from "./context.js";

export const DEFAULT_PAGE_BYTES = 4096;
export const MIN_PAGE_BYTES = 2048;

export interface SavedResult {
	maxResponseBytes: number;
	recordCount: number;
	sampleText?(start: number, count: number): string | undefined;
	firstPagePriorityCount?: number;
	compose(start: number, count: number): Record<string, unknown>;
}
/** Page ordered arrays while retaining a single summary for the task window. */
export function sectionedResult(
	maxResponseBytes: number,
	summary: Record<string, unknown>,
	sections: Record<string, readonly unknown[]>,
	firstPagePriorityCount = 0,
): SavedResult {
	const lists = Object.entries(sections);
	return {
		maxResponseBytes,
		firstPagePriorityCount,
		recordCount: lists.reduce((total, [, items]) => total + items.length, 0),
		compose(start, count) {
			const result = { ...summary };
			let offset = 0;
			for (const [name, items] of lists) {
				result[name] = items.slice(
					Math.max(0, start - offset),
					Math.max(0, start + count - offset),
				);
				offset += items.length;
			}
			return result;
		},
	};
}

export interface PageReadOptions {
	resultCursor?: string | undefined;
	limit?: number | undefined;
	maxResponseBytes?: number | undefined;
}

export function mirroredResult(payload: Record<string, unknown>) {
	return toolResult(payload, JSON.stringify(payload));
}

// Include the stdio JSON-RPC envelope and leave room for SDK-added protocol
// metadata. Reserving a usual ID width also keeps retries stable across IDs.
export function responseBodyBudget(bytes: number, requestId: number | string) {
	return (
		bytes - 256 - Math.max(20, Buffer.byteLength(JSON.stringify(requestId)))
	);
}

export function savedResultPage(
	taskId: string,
	header: Record<string, unknown>,
	snapshot: SavedResult,
	options: PageReadOptions,
	budget: number,
) {
	const prefix = `result:${taskId}:`;
	const { recordCount, firstPagePriorityCount = 0 } = snapshot;
	let start = 0;
	if (options.resultCursor !== undefined) {
		const suffix = options.resultCursor.slice(prefix.length);
		start = Number(suffix);
		if (
			!options.resultCursor.startsWith(prefix) ||
			!/^[1-9]\d*$/.test(suffix) ||
			!Number.isSafeInteger(start) ||
			start >= recordCount
		)
			throw new GarbroError(
				"INVALID_ARGUMENT",
				"Invalid resultCursor for this task",
			);
	}
	const end = Math.min(recordCount, start + (options.limit ?? recordCount));
	function render(count: number, pageHeader = header) {
		const next = start + count;
		const result = {
			...snapshot.compose(start, count),
			resultCursor: next < recordCount ? prefix + next : null,
		};
		const response = mirroredResult({ ...pageHeader, result });
		const text = snapshot.sampleText?.(start, count);
		if (text) response.content.unshift({ type: "text", text });
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
		// A split first page can prioritize the records used for selection.
		if (
			start === 0 &&
			firstPagePriorityCount > 0 &&
			low > firstPagePriorityCount
		)
			return render(firstPagePriorityCount) ?? best;
		return best;
	}
	// Timestamps and progress are optional on a saved result. Keep the
	// complete first sample if it fits with the essential task fields.
	const compact = render(Math.min(1, available), {
		taskId,
		type: header.type,
		state: header.state,
		revision: header.revision,
		waitOutcome: header.waitOutcome,
		outcome: header.outcome,
	});
	if (compact) return compact;
	throw new GarbroError(
		"LIMIT_EXCEEDED",
		`A saved result record cannot fit this page. Retry get_task with a larger maxResponseBytes (maximum ${MAX_RESPONSE_BYTES}).`,
		{
			details: {
				taskId,
				...(options.resultCursor && { resultCursor: options.resultCursor }),
			},
		},
	);
}
