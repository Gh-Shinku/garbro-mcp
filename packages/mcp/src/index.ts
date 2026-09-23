#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseResourceCatalog, WorkspacePolicy } from "@garbro-mcp/core";
import {
	createDefaultVocabularyRegistry,
	parseSemanticMap,
	readSemanticCatalog,
	resourceAliasesToSemanticRecords,
} from "@garbro-mcp/semantic";
import { BUILD_IDENTITY } from "./build.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			"input-root": { type: "string", multiple: true },
			"output-root": { type: "string", multiple: true },
			"expected-build-id": { type: "string" },
			"resource-catalog": { type: "string", multiple: true },
			"semantic-catalog": { type: "string", multiple: true },
			"semantic-map": { type: "string", multiple: true },
			doctor: { type: "boolean" },
			json: { type: "boolean" },
			help: { type: "boolean", short: "h" },
			version: { type: "boolean", short: "v" },
		},
	});

	if (values.help) {
		console.error(`Usage: garbro-mcp-server [options]

Options:
  --input-root <id=path>    Add a named readable root (repeatable)
  --output-root [id=]<path> Add a writable root (repeatable with IDs)
  --expected-build-id <id> Refuse to start a different build
  --resource-catalog <path> Load an external alias catalog (repeatable)
  --semantic-catalog <path> Load a portable semantic JSONL catalog (repeatable)
  --semantic-map <path>     Load a user JSON or CSV semantic map (repeatable)
  --doctor                  Validate build identity and workspace access
  --json                    Emit machine-readable version or doctor output
  -v, --version             Show the server version
  -h, --help                Show this help`);
		return;
	}

	if (values.version) {
		console.log(
			values.json ? JSON.stringify(BUILD_IDENTITY) : BUILD_IDENTITY.version,
		);
		return;
	}

	const inputRoots = values["input-root"]?.reduce<Record<string, string>>(
		(roots, declaration) => {
			const separator = declaration.indexOf("=");
			if (separator <= 0 || separator === declaration.length - 1)
				throw new Error(`Invalid --input-root value: ${declaration}`);
			const id = declaration.slice(0, separator);
			if (roots[id] !== undefined)
				throw new Error(`Duplicate --input-root ID: ${id}`);
			roots[id] = declaration.slice(separator + 1);
			return roots;
		},
		Object.create(null) as Record<string, string>,
	);
	const outputDeclarations = values["output-root"];
	let outputRoot: string | undefined;
	let outputRoots: Record<string, string> | undefined;
	if (outputDeclarations !== undefined) {
		outputRoots = Object.create(null) as Record<string, string>;
		for (const declaration of outputDeclarations) {
			const separator = declaration.indexOf("=");
			if (separator < 0) {
				if (outputDeclarations.length > 1)
					throw new Error(
						"Repeated --output-root values must use id=path declarations",
					);
				outputRoot = declaration;
				outputRoots = undefined;
				break;
			}
			if (separator === 0 || separator === declaration.length - 1)
				throw new Error(`Invalid --output-root value: ${declaration}`);
			const id = declaration.slice(0, separator);
			if (outputRoots[id] !== undefined)
				throw new Error(`Duplicate --output-root ID: ${id}`);
			outputRoots[id] = declaration.slice(separator + 1);
		}
	}

	if (
		values["expected-build-id"] !== undefined &&
		values["expected-build-id"] !== BUILD_IDENTITY.buildId
	)
		throw new Error(
			`Build identity mismatch: expected ${values["expected-build-id"]}, running ${BUILD_IDENTITY.buildId}`,
		);

	const workspace = new WorkspacePolicy({
		...(inputRoots === undefined ? {} : { inputRoots }),
		...(outputRoot === undefined ? {} : { outputRoot }),
		...(outputRoots === undefined ? {} : { outputRoots }),
	});
	const resourceCatalogs = await Promise.all(
		(values["resource-catalog"] ?? []).map(async (path) => {
			const bytes = await readFile(path);
			return {
				path,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				catalog: parseResourceCatalog(JSON.parse(bytes.toString("utf8"))),
			};
		}),
	);
	const resourceAliases = resourceCatalogs.flatMap(
		({ catalog }) => catalog.resources,
	);
	const defaultResourceRootId = workspace.inputRoots[0]?.id;
	if (defaultResourceRootId === undefined)
		throw new Error("At least one input root is required");
	const semanticMapImports = await Promise.all(
		(values["semantic-map"] ?? []).map(async (path) => {
			const extension = extname(path).toLowerCase();
			if (extension !== ".json" && extension !== ".csv")
				throw new Error(`Semantic map must be JSON or CSV: ${path}`);
			return parseSemanticMap(
				await readFile(path),
				extension === ".csv" ? "csv" : "json",
				{ rootId: "external-semantic-map", path: basename(path) },
				{ defaultResourceRootId },
			);
		}),
	);
	const semanticRecords = [
		...resourceCatalogs.flatMap(({ path, catalog, sha256 }) =>
			resourceAliasesToSemanticRecords(
				catalog.resources,
				{ rootId: "external-resource-catalog", path: basename(path) },
				sha256,
			),
		),
		...semanticMapImports.flatMap((item) => item.records),
	];
	const vocabularies = createDefaultVocabularyRegistry();
	const semanticCatalogs = await Promise.all(
		(values["semantic-catalog"] ?? []).map((path) =>
			readSemanticCatalog(resolve(path), vocabularies),
		),
	);

	if (values.doctor) {
		await workspace.prepare();
		for (const root of workspace.outputRoots)
			await access(root.path, constants.R_OK | constants.W_OK);
		const result = {
			status: "ok",
			build: BUILD_IDENTITY,
			inputRoots: workspace.inputRoots,
			outputRoot: workspace.outputRoot,
			outputRoots: workspace.outputRoots,
			resourceCatalogEntries: resourceAliases.length,
			semanticRecords: semanticRecords.length,
			semanticCatalogs: semanticCatalogs.length,
		};
		console.log(
			values.json ? JSON.stringify(result) : `ok ${BUILD_IDENTITY.buildId}`,
		);
		return;
	}

	void serveStdio(() =>
		buildServer({
			workspace,
			resourceAliases,
			semanticRecords,
			semanticCatalogs,
		}),
	);
	console.error("garbro-mcp server running on stdio");
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
