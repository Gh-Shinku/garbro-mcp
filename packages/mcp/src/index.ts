#!/usr/bin/env node

import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { parseArgs } from "node:util";
import { TemporaryWorkspaceManager } from "@garbro-mcp/core";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { BUILD_IDENTITY } from "./build.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			"temp-dir": { type: "string" },
			"temp-retention-hours": { type: "string" },
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
  --temp-dir <path>         Override the OS temporary workspace directory
  --temp-retention-hours <n> Keep completed task artifacts for n hours (default: 24)
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

	const retentionHours = Number(values["temp-retention-hours"] ?? "24");
	if (!Number.isFinite(retentionHours) || retentionHours <= 0)
		throw new Error("--temp-retention-hours must be a positive number");
	const retentionMs = Math.round(retentionHours * 60 * 60 * 1000);

	if (
		values["expected-build-id"] !== undefined &&
		values["expected-build-id"] !== BUILD_IDENTITY.buildId
	)
		throw new Error(
			`Build identity mismatch: expected ${values["expected-build-id"]}, running ${BUILD_IDENTITY.buildId}`,
		);

	const temporary = new TemporaryWorkspaceManager({
		...(values["temp-dir"] === undefined
			? {}
			: { tempDirectory: values["temp-dir"] }),
		retentionMs,
	});
	if (values.doctor) {
		await temporary.prepare();
		await access(temporary.tempDirectory, constants.R_OK | constants.W_OK);
		const result = {
			status: "ok",
			build: BUILD_IDENTITY,
			temporaryWorkspace: {
				path: temporary.tempDirectory,
				retentionMs: temporary.retentionMs,
			},
		};
		console.log(
			values.json ? JSON.stringify(result) : `ok ${BUILD_IDENTITY.buildId}`,
		);
		return;
	}

	void serveStdio(() =>
		buildServer({
			tempDirectory: temporary.tempDirectory,
			retentionMs: temporary.retentionMs,
		}),
	);
	console.error("garbro-mcp server running on stdio");
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
