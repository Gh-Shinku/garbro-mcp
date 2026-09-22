import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	ArchiveAutomationService,
	readExtractionReport,
	WorkspacePolicy,
	writeExtractionReport,
} from "@garbro-mcp/core";
import { createDefaultRegistry } from "@garbro-mcp/formats";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const xp3Fixture = resolve(repositoryRoot, "fixtures/xp3/basic.xp3");
const temporaryDirectories: string[] = [];

async function setup(): Promise<{
	root: string;
	output: string;
	service: ArchiveAutomationService;
}> {
	const root = await mkdtemp(resolve(tmpdir(), "garbro-automation-test-"));
	temporaryDirectories.push(root);
	const output = resolve(root, "output");
	await mkdir(resolve(root, "archives"));
	await copyFile(xp3Fixture, resolve(root, "archives/basic.xp3"));
	const workspace = new WorkspacePolicy({
		inputRoots: { games: root },
		outputRoot: output,
	});
	await workspace.prepare();
	return {
		root,
		output,
		service: new ArchiveAutomationService(createDefaultRegistry(), workspace),
	};
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("ArchiveAutomationService", () => {
	it("inspects archives and filters paginated entries", async () => {
		const { service } = await setup();
		const source = { rootId: "games", path: "archives\\basic.xp3" };

		await expect(service.inspectArchive(source)).resolves.toMatchObject({
			recognized: true,
			validation: "structural",
			confidence: expect.stringMatching(/^(low|medium|high)$/),
			warnings: expect.any(Array),
			source: { rootId: "games", path: "archives/basic.xp3" },
			format: { id: "xp3" },
			summary: { entryCount: 3 },
		});
		await expect(
			service.listEntries(source, { includeGlobs: ["**/*.tjs"], limit: 1 }),
		).resolves.toMatchObject({
			archiveTotal: 3,
			matchedTotal: 1,
			entries: [{ id: "1", path: "scripts/startup.tjs" }],
			nextOffset: null,
		});
	});

	it("returns bounded text and hex previews", async () => {
		const { service } = await setup();
		const source = { rootId: "games", path: "archives/basic.xp3" };

		const text = await service.previewEntry(source, "0", { maxBytes: 5 });
		expect(text.preview).toMatchObject({
			kind: "text",
			bytesRead: 5,
			truncated: true,
		});
		const binary = await service.previewEntry(source, "2");
		expect(binary.preview).toMatchObject({
			kind: "hex",
			bytesRead: 6,
			truncated: false,
		});
	});

	it("scans deterministically with opaque cursors and skips its output root", async () => {
		const { root, output, service } = await setup();
		await copyFile(xp3Fixture, resolve(root, "archives/second.xp3"));
		await writeFile(resolve(root, "archives/readme.txt"), "not an archive");
		await copyFile(xp3Fixture, resolve(output, "ignored.xp3"));

		const first = await service.scanArchives("games", {
			path: "archives",
			limit: 1,
		});
		expect(first.scanned).toBe(1);
		expect(first.archives).toHaveLength(1);
		expect(first.nextCursor).not.toBeNull();
		if (!first.nextCursor) throw new Error("expected another scan page");
		const second = await service.scanArchives("games", {
			path: "archives",
			limit: 10,
			cursor: first.nextCursor,
			includeUnrecognized: true,
		});
		expect(second.archives).toHaveLength(1);
		expect(second.unrecognized).toEqual([
			{ rootId: "games", path: "archives/readme.txt" },
		]);
		expect(second.complete).toBe(true);
	});

	it("preflights conflicts and reports per-entry extraction outcomes", async () => {
		const { output, service } = await setup();
		const source = { rootId: "games", path: "archives/basic.xp3" };
		const target = resolve(output, "job");
		await mkdir(target);
		await writeFile(resolve(target, "hello.txt"), "existing");

		const result = await service.extractEntries(source, {
			selection: { mode: "ids", entryIds: ["0", "1", "missing"] },
			outputSubdirectory: "job",
			conflictPolicy: "fail",
		});
		expect(result).toMatchObject({
			status: "partial",
			hasFailures: true,
			selected: 3,
			extracted: 1,
			failed: 2,
		});
		expect(result.items.map((item) => item.status)).toEqual([
			"failed",
			"extracted",
			"failed",
		]);
		expect(await readFile(resolve(target, "hello.txt"), "utf8")).toBe(
			"existing",
		);
		expect(await readFile(resolve(target, "scripts/startup.tjs"))).toHaveLength(
			26,
		);
		const report = await writeExtractionReport(service.workspace, result);
		const saved = JSON.parse(await readFile(report.absolutePath, "utf8"));
		expect(saved.bytesWritten).toBe("26");
		expect(saved.items[0].error.code).toBe("OUTPUT_EXISTS");
		expect(saved.items[0]).toMatchObject({
			formatId: "xp3",
			decoderId: "xp3",
		});
		expect(saved.items[1].artifact.sha256).toHaveLength(64);
		const loaded = await readExtractionReport(
			service.workspace,
			report.relativePath,
		);
		expect(loaded.report).toEqual(saved);
		expect(loaded.artifact.sha256).toBe(report.sha256);
		await expect(
			readExtractionReport(service.workspace, "../escape.json"),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

		const failed = await service.extractEntries(source, {
			selection: { mode: "ids", entryIds: ["missing"] },
			outputSubdirectory: "failed-job",
		});
		expect(failed).toMatchObject({ status: "failed", hasFailures: true });
		await expect(stat(resolve(output, "failed-job"))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("plans costs without writing and enforces digests and hard budgets", async () => {
		const { output, service } = await setup();
		const source = { rootId: "games", path: "archives/basic.xp3" };
		const plan = await service.planExtraction(source, {
			outputSubdirectory: "planned",
			budgets: { maxResources: 2 },
		});
		expect(plan).toMatchObject({
			selected: 3,
			ready: 3,
			failed: 0,
			unknownOutputSizes: 0,
			budgetViolations: [{ budget: "maxResources", actual: 3n, limit: 2n }],
			budgetUnknowns: [],
		});
		expect(plan.inputBytes).toBeGreaterThan(0n);
		expect(plan.outputBytes).toBeGreaterThan(0n);
		expect(plan.planDigest).toHaveLength(64);
		await expect(stat(resolve(output, "planned"))).rejects.toMatchObject({
			code: "ENOENT",
		});

		await expect(
			service.extractEntries(source, {
				outputSubdirectory: "planned",
				expectedPlanDigest: plan.planDigest,
				budgets: { maxResources: 2 },
			}),
		).rejects.toMatchObject({
			code: "LIMIT_EXCEEDED",
			details: {
				violations: [{ budget: "maxResources", actual: "3", limit: "2" }],
			},
		});
		await expect(stat(resolve(output, "planned"))).rejects.toMatchObject({
			code: "ENOENT",
		});

		const executable = await service.planExtraction(source, {
			outputSubdirectory: "planned",
			budgets: { maxResources: 3, maxOutputBytes: 1024n },
		});
		await mkdir(resolve(output, "planned"));
		await writeFile(resolve(output, "planned/hello.txt"), "changed");
		await expect(
			service.extractEntries(source, {
				outputSubdirectory: "planned",
				expectedPlanDigest: executable.planDigest,
				budgets: { maxResources: 3, maxOutputBytes: 1024n },
			}),
		).rejects.toMatchObject({ code: "PLAN_CHANGED" });
	});
});
