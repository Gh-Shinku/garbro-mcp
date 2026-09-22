#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { parseArgs } from "node:util";
import { WorkspacePolicy } from "@garbro-mcp/core";
import { BUILD_IDENTITY } from "./build.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			"input-root": { type: "string", multiple: true },
			"output-root": { type: "string", multiple: true },
			"expected-build-id": { type: "string" },
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
		};
		console.log(
			values.json ? JSON.stringify(result) : `ok ${BUILD_IDENTITY.buildId}`,
		);
		return;
	}

	void serveStdio(() =>
		buildServer({
			workspace,
		}),
	);
	console.error("garbro-mcp server running on stdio");
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
