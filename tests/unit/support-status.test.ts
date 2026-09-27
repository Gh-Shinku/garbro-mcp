import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateSupportStatus } from "../../scripts/validate-support-status.mjs";

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(resolve(path), "utf8"));
}

describe("support status validation", () => {
	it("accepts the checked-in catalog and gap taxonomy", async () => {
		const [status, taxonomy] = await Promise.all([
			readJson("docs/support-status.json"),
			readJson("docs/support-gap-codes.json"),
		]);

		expect(() => validateSupportStatus(status, taxonomy)).not.toThrow();
	});

	it("rejects unregistered gap codes", () => {
		const status = {
			schemaVersion: 2,
			implementations: [
				{
					localId: "example",
					readStatus: "complete",
					gaps: [{ code: "missing.code", disposition: "verification" }],
				},
			],
		};
		const taxonomy = { schemaVersion: 1, codes: [] };

		expect(() => validateSupportStatus(status, taxonomy)).toThrow(
			"example: unknown gap missing.code",
		);
	});

	it("requires planned and external gaps for incomplete readers", () => {
		const taxonomy = { schemaVersion: 1, codes: [] };
		const status = {
			schemaVersion: 2,
			implementations: [
				{ localId: "partial", readStatus: "partial", gaps: [] },
				{ localId: "blocked", readStatus: "blocked", gaps: [] },
			],
		};

		expect(() => validateSupportStatus(status, taxonomy)).toThrow(
			/partial: partial readers require a planned gap[\s\S]*blocked: blocked readers require an external gap/,
		);
	});
});
