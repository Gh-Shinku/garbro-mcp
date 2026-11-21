import { extname, resolve } from "node:path";
import type { ScanFailure, UnrecognizedResource } from "@garbro-mcp/core";

interface Diagnostic {
	kind: string;
	formatId?: string;
	version?: number;
	stage: string;
	message: string;
	nextAction: string;
}

export function directoryDiagnostics(
	root: string,
	failures: readonly ScanFailure[],
	unrecognized: readonly UnrecognizedResource[],
) {
	const groups = new Map<
		string,
		Diagnostic & {
			extension: string | null;
			count: number;
			exampleSource: { path: string };
		}
	>();
	function add(path: string, diagnosis: Diagnostic) {
		const extension = extname(path).slice(1).toLowerCase() || null;
		const key = JSON.stringify([extension, diagnosis]);
		const group = groups.get(key);
		if (group) group.count++;
		else
			groups.set(key, {
				...diagnosis,
				extension,
				count: 1,
				exampleSource: { path: resolve(root, path) },
			});
	}
	for (const { source, error } of failures) {
		const details = error.details;
		add(source.path, {
			kind: typeof details?.kind === "string" ? details.kind : error.code,
			...(typeof details?.formatId === "string"
				? { formatId: details.formatId }
				: {}),
			...(typeof details?.version === "number"
				? { version: details.version }
				: {}),
			stage:
				typeof details?.stage === "string" ? details.stage : "file-inspection",
			message: error.message,
			nextAction:
				typeof details?.nextAction === "string"
					? details.nextAction
					: "Inspect the example file individually for the full error details.",
		});
	}
	for (const { source, diagnosis } of unrecognized) {
		const { kind, stage, message, nextAction } = diagnosis;
		add(source.path, { kind, stage, message, nextAction });
	}
	return Array.from(groups.values());
}

export function directoryDiagnosticText(
	groups: ReturnType<typeof directoryDiagnostics>,
) {
	return groups
		.slice(0, 5)
		.map(
			(g) =>
				`${g.count} × ${g.message} ${g.nextAction} Example: ${JSON.stringify(g.exampleSource.path)}`,
		)
		.join("\n");
}
