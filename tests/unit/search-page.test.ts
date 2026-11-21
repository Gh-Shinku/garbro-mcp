import { expect, it } from "vitest";
import {
	searchBodyBudget,
	searchResultPage,
	searchSnapshot,
} from "../../packages/mcp/src/search-page.js";

it("retains a multibyte record that exceeds a page and resumes at the same cursor", () => {
	const source = { path: "/data/game.xp3" };
	const entries = ["voice.ogg", `${"語".repeat(1800)}.ogg`].map((path, i) => ({
		id: String(i),
		path,
		resourceType: "audio",
		extractSource: {
			source,
			selection: { mode: "ids", entryIds: [String(i)] },
		},
	}));
	const snapshot = searchSnapshot(
		{
			scanned: 1,
			complete: true,
			nextCursor: null,
			archives: [{ source, formatId: "xp3", matchedTotal: 2, entries }],
			diagnostics: [],
			failures: [],
		},
		4096,
	);
	const taskId = "sample-task";
	const header = {
		taskId,
		state: "completed",
		type: "search",
		revision: 3,
		waitOutcome: "snapshot",
		outcome: { status: "ok", warnings: [] },
	};
	const small = searchBodyBudget(4096, 1);
	const first = searchResultPage(taskId, header, snapshot, {}, small);
	const result = JSON.parse(first.content[0]?.text ?? "");
	expect(result.result.archives[0].entries).toEqual(entries.slice(0, 1));
	const resultCursor = result.result.resultCursor;
	expect(() =>
		searchResultPage(taskId, header, snapshot, { resultCursor }, small),
	).toThrow(
		expect.objectContaining({
			code: "LIMIT_EXCEEDED",
			details: { taskId, resultCursor },
		}),
	);
	const response = searchResultPage(
		taskId,
		header,
		snapshot,
		{ resultCursor },
		searchBodyBudget(16384, 2),
	);
	expect(response.structuredContent).toMatchObject({
		result: { resultCursor: null, archives: [{ entries: entries.slice(1) }] },
	});
	expect(JSON.parse(response.content[0]?.text ?? "")).toEqual(
		response.structuredContent,
	);
	expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThan(16384);
});
