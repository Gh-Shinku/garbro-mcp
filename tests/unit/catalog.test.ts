import * as formats from "@garbro-mcp/formats";
import { createDefaultRegistry } from "@garbro-mcp/formats";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("format catalog integrity", () => {
	it("registers every exported format descriptor", () => {
		const registeredIds = new Set(
			createDefaultRegistry()
				.listFormats()
				.map((format) => format.id),
		);
		const exportedDescriptors = Object.entries(formats).filter(
			([name, value]) =>
				name.endsWith("Descriptor") &&
				typeof value === "object" &&
				value !== null &&
				"id" in value &&
				typeof (value as { id: unknown }).id === "string",
		);
		expect(exportedDescriptors.length).toBeGreaterThan(0);
		const unregistered = exportedDescriptors
			.filter(
				([, descriptor]) =>
					!registeredIds.has((descriptor as { id: string }).id),
			)
			.map(([name]) => name);
		expect(unregistered).toEqual([]);
	});

	it("re-exports every format directory", async () => {
		const sourceRoot = resolve("packages/formats/src");
		const directories = (await readdir(sourceRoot, { withFileTypes: true }))
			.filter(
				(entry) =>
					entry.isDirectory() &&
					entry.name !== "shared" &&
					!entry.name.startsWith("."),
			)
			.map((entry) => entry.name)
			.sort();
		const indexSource = await readFile(resolve(sourceRoot, "index.ts"), "utf8");
		const missing = directories.filter(
			(directory) =>
				!indexSource.includes(`export * from "./${directory}/index.js";`),
		);
		expect(missing).toEqual([]);
	});
});
