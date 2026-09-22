import { GarbroError } from "@garbro-mcp/core";

export const DEFAULT_RESPONSE_BYTES = 16 * 1024;
export const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_INLINE_TEXT_BYTES = 1024;

export function toolResult<T extends Record<string, unknown>>(payload: T) {
	const serialized = JSON.stringify(payload);
	const text =
		Buffer.byteLength(serialized, "utf8") <= MAX_INLINE_TEXT_BYTES
			? serialized
			: JSON.stringify({
					notice: "Full result is available in structuredContent.",
				});
	return {
		content: [{ type: "text" as const, text }],
		structuredContent: payload,
	};
}

/** Budget the actual result, including the compatibility text copy. */
export function fitsResponse(
	payload: Record<string, unknown>,
	budget: number,
): boolean {
	return (
		Buffer.byteLength(JSON.stringify(toolResult(payload)), "utf8") <= budget
	);
}

/** Never skip an oversized item: fail explicitly instead of returning a stuck cursor. */
export function boundedPage<T, R extends Record<string, unknown>>(
	items: readonly T[],
	compose: (items: readonly T[]) => R,
	budget: number,
	allowEmpty = false,
): R {
	for (let count = items.length; count >= 0; count -= 1) {
		const result = compose(items.slice(0, count));
		if (fitsResponse(result, budget)) {
			if (count === 0 && items.length > 0 && !allowEmpty) break;
			return result;
		}
	}
	throw new GarbroError(
		"LIMIT_EXCEEDED",
		"One item cannot fit the response budget. Use summary detail or increase maxResponseBytes.",
	);
}
