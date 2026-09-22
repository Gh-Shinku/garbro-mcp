import { parseResourceCatalog, ResourceCatalogIndex } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";

describe("resource alias catalog", () => {
	it("finds exact aliases before partial path matches", () => {
		const catalog = parseResourceCatalog({
			schemaVersion: 1,
			resources: [
				{
					aliases: ["散花"],
					locale: "ja-JP",
					locator: {
						source: { rootId: "games", path: "Rewrite/bgm/BGM042.nwa" },
					},
					metadata: { title: "Sange", durationSeconds: 180, channels: 2 },
				},
				{
					aliases: ["BGM042 alternate"],
					locator: {
						source: { rootId: "games", path: "Other/sange.ogg" },
					},
				},
			],
		});
		const index = new ResourceCatalogIndex(catalog.resources);

		expect(index.search("散花")).toMatchObject([
			{
				exact: true,
				matchedBy: "alias",
				resource: {
					locator: { source: { path: "Rewrite/bgm/BGM042.nwa" } },
				},
			},
		]);
		expect(index.search("sange")).toHaveLength(2);
		expect(index.search("散花", { minDurationSeconds: 200 })).toHaveLength(0);
	});

	it("rejects malformed locators and hashes", () => {
		expect(() =>
			parseResourceCatalog({
				schemaVersion: 1,
				resources: [{ aliases: ["track"], locator: { source: {} } }],
			}),
		).toThrow(/incomplete/);
		expect(() =>
			parseResourceCatalog({
				schemaVersion: 1,
				resources: [
					{
						aliases: ["track"],
						locator: { source: { rootId: "games", path: "track.nwa" } },
						expected: { sha256: "bad" },
					},
				],
			}),
		).toThrow(/sha256/);
	});
});
