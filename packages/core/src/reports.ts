import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtractedArtifact } from "./automation.js";
import { GarbroError } from "./errors.js";
import type { VerifiedExtractionResult } from "./verification.js";
import type { WorkspacePolicy } from "./workspace.js";

/** Store a complete extraction report outside the caller's inline response. */
export async function writeExtractionReport(
	workspace: WorkspacePolicy,
	result: VerifiedExtractionResult,
): Promise<ExtractedArtifact> {
	const directory = await workspace.resolveOutputDirectory(
		".garbro-reports",
		result.outputRootId,
	);
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
		outputRootId: result.outputRootId,
		relativePath: `.garbro-reports/${name}`,
		absolutePath: path,
		bytesWritten: BigInt(bytes.length),
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
}

/** Read only generated report paths, without creating output directories. */
export async function readExtractionReport(
	workspace: WorkspacePolicy,
	relativePath: string,
	outputRootId?: string,
): Promise<{ report: unknown; artifact: ExtractedArtifact }> {
	if (
		!/^\.garbro-reports\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/.test(
			relativePath,
		)
	)
		throw new GarbroError(
			"INVALID_ARGUMENT",
			"Expected a generated .garbro-reports/<id>.json path",
		);
	const outputRoot = workspace.resolveOutputRoot(outputRootId);
	const resolvedOutputRootId =
		outputRootId ?? workspace.outputRoots[0]?.id ?? "default";
	for (const directory of [
		outputRoot,
		resolve(outputRoot, ".garbro-reports"),
	]) {
		const info = await lstat(directory);
		if (info.isSymbolicLink() || !info.isDirectory())
			throw new GarbroError(
				"UNSAFE_PATH",
				"Report directory is not a real directory",
			);
	}
	const path = resolve(outputRoot, relativePath);
	const canonicalRoot = await realpath(outputRoot);
	const relation = relative(canonicalRoot, await realpath(path));
	if (
		isAbsolute(relation) ||
		relation === ".." ||
		relation.startsWith(`..${sep}`) ||
		(await lstat(path)).isSymbolicLink()
	)
		throw new GarbroError(
			"UNSAFE_PATH",
			"Report path escapes the output root or is a symbolic link",
		);
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const info = await file.stat();
		if (!info.isFile())
			throw new GarbroError("UNSAFE_PATH", "Report is not a regular file");
		if (info.size > 64 * 1024 * 1024)
			throw new GarbroError("LIMIT_EXCEEDED", "Report exceeds 64 MiB");
		const bytes = await file.readFile();
		return {
			report: JSON.parse(bytes.toString("utf8")) as unknown,
			artifact: {
				outputRootId: resolvedOutputRootId,
				relativePath,
				absolutePath: path,
				bytesWritten: BigInt(bytes.length),
				sha256: createHash("sha256").update(bytes).digest("hex"),
			},
		};
	} finally {
		await file.close();
	}
}
