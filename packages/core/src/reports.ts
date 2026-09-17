import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BatchExtractionResult, ExtractedArtifact } from "./automation.js";
import { GarbroError } from "./errors.js";
import type { WorkspacePolicy } from "./workspace.js";

/** Store a complete extraction report outside the caller's inline response. */
export async function writeExtractionReport(
	workspace: WorkspacePolicy,
	result: BatchExtractionResult,
): Promise<ExtractedArtifact> {
	const directory = await workspace.resolveOutputDirectory(".garbro-reports");
	const name = `${randomUUID()}.json`;
	const path = resolve(directory, name);
	const bytes = Buffer.from(
		JSON.stringify(
			result,
			(_key, value: unknown) => {
				if (typeof value === "bigint") return value.toString();
				if (value instanceof GarbroError)
					return {
						code: value.code,
						message: value.message,
						...(value.details === undefined ? {} : { details: value.details }),
					};
				return value;
			},
			2,
		),
	);
	await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
	return {
		relativePath: `.garbro-reports/${name}`,
		absolutePath: path,
		bytesWritten: BigInt(bytes.length),
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
}
