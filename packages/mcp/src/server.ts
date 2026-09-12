import {
	asGarbroError,
	detectionToWire,
	entryToWire,
	extractArchive,
	extractEntry,
	formatToWire,
	type ArchiveHandle,
	type FormatRegistry,
} from "@garbro-mcp/core";
import { createDefaultRegistry } from "@garbro-mcp/formats";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const pathSchema = z.string().min(1);
const formatSchema = z.record(z.string(), z.unknown());
const entrySchema = z.record(z.string(), z.unknown());
const errorOutputSchema = z.object({
	error: z.object({
		code: z.enum([
			"INVALID_ARCHIVE",
			"UNSUPPORTED_FEATURE",
			"ENTRY_NOT_FOUND",
			"UNSAFE_PATH",
			"OUTPUT_EXISTS",
			"IO_ERROR",
		]),
		message: z.string(),
		details: z.record(z.string(), z.unknown()).optional(),
	}),
});
const detectOutputSchema = z.union([
	z.object({ detected: z.literal(false) }),
	z.object({
		detected: z.literal(true),
		path: z.string(),
		size: z.string(),
		format: formatSchema,
	}),
	errorOutputSchema,
]);
const listEntriesOutputSchema = z.union([
	z.object({
		archivePath: z.string(),
		archiveSize: z.string(),
		format: formatSchema,
		metadata: z.record(z.string(), z.unknown()),
		total: z.number().int().min(0),
		offset: z.number().int().min(0),
		limit: z.number().int().min(1),
		nextOffset: z.number().int().min(0).nullable(),
		entries: z.array(entrySchema),
	}),
	errorOutputSchema,
]);
const extractEntryOutputSchema = z.union([
	z.object({
		archivePath: z.string(),
		outputPath: z.string(),
		bytesWritten: z.string(),
		sha256: z.string(),
		entry: entrySchema,
	}),
	errorOutputSchema,
]);
const extractArchiveOutputSchema = z.union([
	z.object({
		archivePath: z.string(),
		outputDirectory: z.string(),
		format: formatSchema,
		extractedEntries: z.number().int().min(0),
		bytesWritten: z.string(),
	}),
	errorOutputSchema,
]);
const listFormatsOutputSchema = z.object({ formats: z.array(formatSchema) });

function success<const T extends Record<string, unknown>>(payload: T) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(payload) }],
		structuredContent: payload,
	};
}

function failure(error: unknown) {
	const garbroError = asGarbroError(error);
	const payload = {
		error: {
			code: garbroError.code,
			message: garbroError.message,
			...(garbroError.details === undefined
				? {}
				: { details: garbroError.details }),
		},
	};
	return {
		content: [{ type: "text" as const, text: JSON.stringify(payload) }],
		structuredContent: payload,
		isError: true,
	};
}

async function withArchive<T>(
	registry: FormatRegistry,
	path: string,
	run: (archive: ArchiveHandle) => Promise<T>,
): Promise<T> {
	const archive = await registry.openArchive(path);
	try {
		return await run(archive);
	} finally {
		await archive.close();
	}
}

export function buildServer(registry = createDefaultRegistry()): McpServer {
	const server = new McpServer({ name: "garbro-mcp", version: "0.0.0" });

	server.registerTool(
		"detect_archive",
		{
			description: "Detect the format of a local archive file",
			inputSchema: z.object({ archivePath: pathSchema }),
			outputSchema: detectOutputSchema,
		},
		async ({ archivePath }) => {
			try {
				const result = await registry.detectArchive(archivePath);
				return success(result ? detectionToWire(result) : { detected: false });
			} catch (error) {
				return failure(error);
			}
		},
	);

	server.registerTool(
		"list_entries",
		{
			description: "List a page of entries and metadata from a local archive",
			inputSchema: z.object({
				archivePath: pathSchema,
				offset: z.number().int().min(0).default(0),
				limit: z.number().int().min(1).max(1000).default(100),
			}),
			outputSchema: listEntriesOutputSchema,
		},
		async ({ archivePath, offset, limit }) => {
			try {
				return await withArchive(registry, archivePath, async (archive) => {
					const entries = archive.entries.slice(offset, offset + limit);
					const nextOffset =
						offset + entries.length < archive.entries.length
							? offset + entries.length
							: null;
					return success({
						archivePath: archive.sourcePath,
						archiveSize: archive.size.toString(),
						format: formatToWire(archive.format),
						metadata: archive.metadata,
						total: archive.entries.length,
						offset,
						limit,
						nextOffset,
						entries: entries.map(entryToWire),
					});
				});
			} catch (error) {
				return failure(error);
			}
		},
	);

	server.registerTool(
		"extract_entry",
		{
			description: "Extract one archive entry to a local directory",
			inputSchema: z.object({
				archivePath: pathSchema,
				entryId: z.string().min(1),
				outputDirectory: pathSchema,
				overwrite: z.boolean().default(false),
			}),
			outputSchema: extractEntryOutputSchema,
		},
		async ({ archivePath, entryId, outputDirectory, overwrite }) => {
			try {
				return await withArchive(registry, archivePath, async (archive) => {
					const result = await extractEntry(archive, entryId, {
						outputDirectory,
						overwrite,
					});
					return success({
						archivePath: archive.sourcePath,
						outputPath: result.outputPath,
						bytesWritten: result.bytesWritten.toString(),
						sha256: result.sha256,
						entry: entryToWire(result.entry),
					});
				});
			} catch (error) {
				return failure(error);
			}
		},
	);

	server.registerTool(
		"extract_archive",
		{
			description:
				"Extract every entry from a local archive to a local directory",
			inputSchema: z.object({
				archivePath: pathSchema,
				outputDirectory: pathSchema,
				overwrite: z.boolean().default(false),
			}),
			outputSchema: extractArchiveOutputSchema,
		},
		async ({ archivePath, outputDirectory, overwrite }) => {
			try {
				return await withArchive(registry, archivePath, async (archive) => {
					const result = await extractArchive(archive, {
						outputDirectory,
						overwrite,
					});
					return success({
						archivePath: archive.sourcePath,
						outputDirectory: result.outputDirectory,
						format: formatToWire(archive.format),
						extractedEntries: result.files.length,
						bytesWritten: result.bytesWritten.toString(),
					});
				});
			} catch (error) {
				return failure(error);
			}
		},
	);

	server.registerTool(
		"list_formats",
		{
			description: "List supported archive formats",
			outputSchema: listFormatsOutputSchema,
		},
		async () => success({ formats: registry.listFormats().map(formatToWire) }),
	);

	return server;
}
