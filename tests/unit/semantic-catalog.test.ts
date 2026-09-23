import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { WorkspacePolicy } from "@garbro-mcp/core";
import {
	createDefaultVocabularyRegistry,
	readSemanticCatalog,
	stableSemanticId,
	type SemanticCatalogHeader,
	type SemanticRecord,
	writeSemanticCatalog,
} from "@garbro-mcp/semantic";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function fixture() {
	const input = await mkdtemp(resolve(tmpdir(), "garbro-semantic-input-"));
	const output = await mkdtemp(resolve(tmpdir(), "garbro-semantic-output-"));
	temporaryDirectories.push(input, output);
	return {
		output,
		workspace: new WorkspacePolicy({
			inputRoots: { games: input },
			outputRoot: output,
		}),
	};
}

function catalogFixture(): {
	header: SemanticCatalogHeader;
	records: SemanticRecord[];
} {
	const evidenceId = stableSemanticId("evidence", {
		source: "mapping.csv",
		line: 2,
	});
	return {
		header: {
			kind: "header",
			schemaVersion: 1,
			game: {
				fingerprint: "a".repeat(64),
				rootId: "games",
				basePath: "Rewrite",
			},
			vocabularies: { garbro: 1, vn: 1 },
			createdBy: { name: "test", version: "1" },
		},
		records: [
			{
				kind: "entity",
				id: "character:kagari",
				type: "vn:character",
				properties: { name: "篝" },
			},
			{
				kind: "resource",
				id: "resource:voice",
				type: "garbro:resource",
				resourceType: "audio",
				locator: {
					source: { rootId: "games", path: "Rewrite/koe/voice.ovk" },
					entryId: "42",
				},
				properties: {},
			},
			{
				kind: "evidence",
				id: evidenceId,
				type: "garbro:userMapping",
				source: {
					locator: { rootId: "games", path: "mapping.csv" },
					sha256: "b".repeat(64),
				},
				producer: { analyzerId: "user.mapping", analyzerVersion: "1" },
				method: "user-assertion",
			},
			{
				kind: "relation",
				id: "relation:voice",
				subject: "character:kagari",
				predicate: "vn:voiceResource",
				object: { kind: "entity", id: "resource:voice" },
				evidenceIds: [evidenceId],
				status: "user-confirmed",
			},
		],
	};
}

describe("semantic catalog", () => {
	it("writes, hashes, reads, validates, and queries a portable JSONL catalog", async () => {
		const { workspace } = await fixture();
		const vocabularies = createDefaultVocabularyRegistry();
		const fixtureData = catalogFixture();
		const written = await writeSemanticCatalog(
			workspace,
			fixtureData.header,
			fixtureData.records,
			vocabularies,
		);
		expect(written.summary).toMatchObject({
			records: 4,
			resources: 1,
			relations: 1,
		});
		const loaded = await readSemanticCatalog(
			written.artifact.absolutePath,
			vocabularies,
		);
		expect(loaded.summary.manifestSha256).toBe(written.artifact.sha256);
		expect(
			loaded.index.query(
				{
					entityType: "vn:character",
					query: "篝",
					predicate: "vn:voiceResource",
				},
				vocabularies,
			),
		).toMatchObject({
			nodes: [{ id: "character:kagari" }],
			relations: [{ id: "relation:voice", status: "user-confirmed" }],
		});
		expect(await readFile(written.artifact.absolutePath, "utf8")).toContain(
			'"schemaVersion":1',
		);
	});

	it("does not install an invalid catalog", async () => {
		const { output, workspace } = await fixture();
		const vocabularies = createDefaultVocabularyRegistry();
		const fixtureData = catalogFixture();
		fixtureData.records.splice(2, 1);
		await expect(
			writeSemanticCatalog(
				workspace,
				fixtureData.header,
				fixtureData.records,
				vocabularies,
			),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
		const files = await readdir(
			resolve(output, ".garbro-semantic", "a".repeat(64)),
		);
		expect(files).toEqual([]);
	});

	it("uses canonical object ordering for stable IDs", () => {
		expect(stableSemanticId("entity", { a: 1, b: 2 })).toBe(
			stableSemanticId("entity", { b: 2, a: 1 }),
		);
	});
});
