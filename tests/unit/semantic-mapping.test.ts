import { createHash } from "node:crypto";
import {
	createDefaultVocabularyRegistry,
	parseSemanticMap,
	resourceAliasesToSemanticRecords,
	SemanticCatalogIndex,
} from "@garbro-mcp/semantic";
import { describe, expect, it } from "vitest";

describe("semantic mapping imports", () => {
	it("imports generic CSV character-to-resource mappings with evidence", () => {
		const bytes = Buffer.from(
			"subject_type,subject_key,subject_name,predicate,resource_type,resource_path,entry_id,root_id,override\n" +
				"vn:character,kagari,篝,vn:voiceResource,audio,Rewrite/koe/z0001.ovk,42,games,true\n",
		);
		const imported = parseSemanticMap(bytes, "csv", {
			rootId: "maps",
			path: "rewrite-voices.csv",
		});
		expect(imported).toMatchObject({
			rows: 1,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		});
		const index = new SemanticCatalogIndex();
		for (const record of imported.records) index.add(record);
		expect(index.validate(createDefaultVocabularyRegistry())).toEqual([]);
		expect([...index.relations.values()]).toMatchObject([
			{
				predicate: "vn:voiceResource",
				status: "user-confirmed",
				qualifiers: { userOverride: true },
			},
		]);
		expect(
			[...index.nodes.values()].find((node) => node.kind === "resource"),
		).toMatchObject({
			locator: {
				source: { rootId: "games", path: "Rewrite/koe/z0001.ovk" },
				entryId: "42",
			},
		});
	});

	it("imports rich JSON mappings without changing the core schema", () => {
		const imported = parseSemanticMap(
			Buffer.from(
				JSON.stringify({
					schemaVersion: 1,
					mappings: [
						{
							subjectType: "appearance:appearance",
							subjectKey: "kagari-smile",
							predicate: "appearance:usesResource",
							resourceType: "image",
							resourcePath: "Rewrite/g00/123.g00",
							subjectProperties: { expression: "smile", layers: [1, 2] },
						},
					],
				}),
			),
			"json",
			{ rootId: "games", path: "appearance.json" },
		);
		expect(
			imported.records.some(
				(record) =>
					record.kind === "entity" && record.type === "appearance:appearance",
			),
		).toBe(true);
	});

	it("bridges existing resource aliases into the semantic relation model", () => {
		const records = resourceAliasesToSemanticRecords(
			[
				{
					aliases: ["散花"],
					locale: "ja-JP",
					locator: {
						source: { rootId: "games", path: "Rewrite/bgm/BGM042.nwa" },
					},
					metadata: { title: "Sange" },
				},
			],
			{ rootId: "maps", path: "aliases.json" },
			"a".repeat(64),
		);
		expect(records).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "relation",
					predicate: "garbro:aliasOf",
				}),
				expect.objectContaining({ kind: "entity", type: "garbro:alias" }),
			]),
		);
	});
});
