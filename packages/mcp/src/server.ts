import {
	ArchiveAutomationService,
	asGarbroError,
	entryToWire,
	formatToWire,
	type ArchiveAutomationOptions,
	type AutomationControl,
	type FormatRegistry,
	WorkspacePolicy,
	type WorkspacePolicyOptions,
} from "@garbro-mcp/core";
import {
	createDefaultRegistry,
	formatSupportCatalog,
} from "@garbro-mcp/formats";
import { McpServer, type ServerContext } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const VERSION = "0.0.0";
const resourceTypes = ["archive", "image", "audio", "script"] as const;
const errorCodes = [
	"INVALID_ARCHIVE",
	"INVALID_ARGUMENT",
	"UNSUPPORTED_FEATURE",
	"ENTRY_NOT_FOUND",
	"UNSAFE_PATH",
	"OUTPUT_EXISTS",
	"LIMIT_EXCEEDED",
	"CANCELLED",
	"IO_ERROR",
] as const;

const errorSchema = z.object({
	code: z.enum(errorCodes),
	message: z.string(),
	details: z.record(z.string(), z.unknown()).optional(),
});
const failureSchema = z.object({ error: errorSchema });
const sourceSchema = z.object({
	rootId: z.string().min(1),
	path: z.string().min(1),
});
const formatSchema = z.object({
	id: z.string(),
	name: z.string(),
	extensions: z.array(z.string()),
	capabilities: z.object({
		detect: z.literal(true),
		list: z.literal(true),
		extract: z.literal(true),
		create: z.boolean(),
		encryption: z.boolean(),
	}),
	attribution: z.array(
		z.object({
			project: z.string(),
			source: z.string(),
			license: z.string(),
			commit: z.string().optional(),
		}),
	),
});
const supportSchema = z.object({
	reference: z.object({
		type: z.enum(resourceTypes),
		tag: z.string(),
		class: z.string(),
		source: z.string(),
	}),
	status: z.string(),
	verification: z.string(),
	supported: z.array(z.string()),
	unsupported: z.array(z.string()),
	remainingVerification: z.array(z.string()).optional(),
});
const entrySchema = z.object({
	id: z.string(),
	path: z.string(),
	rawPath: z.string().optional(),
	size: z.string(),
	sizeKnown: z.boolean().optional(),
	packedSize: z.string(),
	compressed: z.boolean(),
	encrypted: z.boolean(),
	checksum: z
		.object({ algorithm: z.literal("adler32"), value: z.string() })
		.optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});
const successOrFailure = <T extends z.ZodType>(schema: T) =>
	z.union([schema, failureSchema]);

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

function toControl(context: ServerContext): AutomationControl {
	const progressToken = (
		context.mcpReq._meta as { progressToken?: string | number } | undefined
	)?.progressToken;
	return {
		signal: context.mcpReq.signal,
		...(progressToken === undefined
			? {}
			: {
					onProgress: async ({ progress, total, message }) => {
						await context.mcpReq.notify({
							method: "notifications/progress",
							params: {
								progressToken,
								progress,
								...(total === undefined ? {} : { total }),
								...(message === undefined ? {} : { message }),
							},
						});
					},
				}),
	};
}

interface SupportRecord {
	localId: string;
	reference: {
		type: (typeof resourceTypes)[number];
		tag: string;
		class: string;
		source: string;
	};
	status: string;
	verification: string;
	supported: readonly string[];
	unsupported: readonly string[];
	remainingVerification?: readonly string[];
}

function supportToWire(support: SupportRecord) {
	return {
		reference: support.reference,
		status: support.status,
		verification: support.verification,
		supported: [...support.supported],
		unsupported: [...support.unsupported],
		...(support.remainingVerification === undefined
			? {}
			: { remainingVerification: [...support.remainingVerification] }),
	};
}

type ExtractionResult = Awaited<
	ReturnType<ArchiveAutomationService["extractEntries"]>
>;

function batchItemToWire(item: ExtractionResult["items"][number]) {
	if (item.status === "extracted")
		return {
			entryId: item.entryId,
			entryPath: item.entryPath,
			status: item.status,
			artifact: {
				...item.artifact,
				bytesWritten: item.artifact.bytesWritten.toString(),
			},
		};
	if (item.status === "skipped") return item;
	return {
		entryId: item.entryId,
		...(item.entryPath === undefined ? {} : { entryPath: item.entryPath }),
		status: item.status,
		error: {
			code: item.error.code,
			message: item.error.message,
			...(item.error.details === undefined
				? {}
				: { details: item.error.details }),
		},
	};
}

export interface BuildServerOptions
	extends WorkspacePolicyOptions,
		ArchiveAutomationOptions {
	registry?: FormatRegistry;
	workspace?: WorkspacePolicy;
}

export function buildServer(options: BuildServerOptions = {}): McpServer {
	const registry = options.registry ?? createDefaultRegistry();
	const workspace =
		options.workspace ??
		new WorkspacePolicy({
			...(options.inputRoots === undefined
				? {}
				: { inputRoots: options.inputRoots }),
			...(options.outputRoot === undefined
				? {}
				: { outputRoot: options.outputRoot }),
			...(options.workingDirectory === undefined
				? {}
				: { workingDirectory: options.workingDirectory }),
		});
	const automation = new ArchiveAutomationService(registry, workspace, {
		...(options.limits === undefined ? {} : { limits: options.limits }),
	});
	const supportById = new Map<string, SupportRecord>(
		(formatSupportCatalog.implementations as readonly SupportRecord[]).map(
			(support) => [support.localId, support],
		),
	);
	const server = new McpServer({ name: "garbro-mcp", version: VERSION });
	const readOnly = {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
	} as const;

	server.registerTool(
		"get_server_info",
		{
			description:
				"Return configured logical roots, output policy, limits, and supported resource categories.",
			outputSchema: successOrFailure(
				z.object({
					server: z.object({
						name: z.literal("garbro-mcp"),
						version: z.string(),
						transport: z.literal("stdio"),
					}),
					inputRoots: z.array(z.object({ id: z.string(), path: z.string() })),
					outputRoot: z.string(),
					limits: z.object({
						previewDefaultBytes: z.number().int().positive(),
						previewMaxBytes: z.number().int().positive(),
						scanPageMax: z.number().int().positive(),
						entryPageMax: z.number().int().positive(),
						maxBatchEntries: z.number().int().positive(),
						scanConcurrency: z.number().int().positive(),
					}),
					capabilities: z.object({
						resourceTypes: z.array(z.enum(resourceTypes)),
						previewModes: z.array(z.enum(["auto", "text", "hex"])),
						conflictPolicies: z.array(z.enum(["fail", "skip", "overwrite"])),
						archiveCreation: z.literal(false),
					}),
				}),
			),
			annotations: readOnly,
		},
		async () => {
			try {
				await workspace.prepare({ createOutput: false });
				return success({
					server: {
						name: "garbro-mcp" as const,
						version: VERSION,
						transport: "stdio" as const,
					},
					inputRoots: workspace.inputRoots.map((root) => ({ ...root })),
					outputRoot: workspace.outputRoot,
					limits: automation.limits,
					capabilities: {
						resourceTypes,
						previewModes: ["auto", "text", "hex"] as const,
						conflictPolicies: ["fail", "skip", "overwrite"] as const,
						archiveCreation: false as const,
					},
				});
			} catch (error) {
				return failure(error);
			}
		},
	);

	server.registerTool(
		"list_formats",
		{
			description:
				"List formats with implementation status, verification level, and known limitations.",
			inputSchema: z.object({
				resourceType: z.enum(resourceTypes).optional(),
				status: z.string().optional(),
				extension: z.string().optional(),
				offset: z.number().int().nonnegative().default(0),
				limit: z.number().int().positive().max(1000).default(200),
			}),
			outputSchema: z.object({
				total: z.number().int().nonnegative(),
				offset: z.number().int().nonnegative(),
				limit: z.number().int().positive(),
				nextOffset: z.number().int().nonnegative().nullable(),
				formats: z.array(formatSchema.extend({ support: supportSchema })),
			}),
			annotations: readOnly,
		},
		async ({ resourceType, status, extension, offset, limit }) => {
			const normalizedExtension = extension?.replace(/^\./, "").toLowerCase();
			const formats = registry
				.listFormats()
				.map((format) => ({ format, support: supportById.get(format.id) }))
				.filter(
					(item): item is typeof item & { support: SupportRecord } =>
						item.support !== undefined,
				)
				.filter(
					({ format, support }) =>
						(resourceType === undefined ||
							support.reference.type === resourceType) &&
						(status === undefined || support.status === status) &&
						(normalizedExtension === undefined ||
							format.extensions.some(
								(candidate) => candidate.toLowerCase() === normalizedExtension,
							)),
				)
				.map(({ format, support }) => ({
					...formatToWire(format),
					support: supportToWire(support),
				}));
			const page = formats.slice(offset, offset + limit);
			return success({
				total: formats.length,
				offset,
				limit,
				nextOffset:
					offset + page.length < formats.length ? offset + page.length : null,
				formats: page,
			});
		},
	);

	server.registerTool(
		"scan_archives",
		{
			description:
				"Scan a configured input root for supported resources and return a resumable page.",
			inputSchema: z.object({
				rootId: z.string().min(1),
				path: z.string().min(1).default("."),
				recursive: z.boolean().default(true),
				includeGlobs: z.array(z.string()).max(32).optional(),
				excludeGlobs: z.array(z.string()).max(32).optional(),
				maxDepth: z.number().int().min(0).max(64).default(8),
				cursor: z.string().min(1).optional(),
				limit: z.number().int().positive().max(500).default(200),
				includeUnrecognized: z.boolean().default(false),
			}),
			outputSchema: successOrFailure(
				z.object({
					scanned: z.number().int().nonnegative(),
					archives: z.array(
						z.object({
							source: sourceSchema,
							size: z.string(),
							format: formatSchema,
						}),
					),
					unrecognized: z.array(sourceSchema),
					unrecognizedCount: z.number().int().nonnegative(),
					failures: z.array(
						z.object({ source: sourceSchema, error: errorSchema }),
					),
					nextCursor: z.string().nullable(),
					complete: z.boolean(),
				}),
			),
			annotations: readOnly,
		},
		async ({ rootId, ...input }, context) => {
			try {
				await workspace.prepare({ createOutput: false });
				const scanOptions = {
					path: input.path,
					recursive: input.recursive,
					maxDepth: input.maxDepth,
					limit: input.limit,
					includeUnrecognized: input.includeUnrecognized,
					...(input.includeGlobs === undefined
						? {}
						: { includeGlobs: input.includeGlobs }),
					...(input.excludeGlobs === undefined
						? {}
						: { excludeGlobs: input.excludeGlobs }),
					...(input.cursor === undefined ? {} : { cursor: input.cursor }),
				};
				const result = await automation.scanArchives(
					rootId,
					scanOptions,
					toControl(context),
				);
				return success({
					...result,
					archives: result.archives.map((archive) => ({
						...archive,
						size: archive.size.toString(),
						format: formatToWire(archive.format),
					})),
					failures: result.failures.map((item) => ({
						source: item.source,
						error: {
							code: item.error.code,
							message: item.error.message,
							...(item.error.details === undefined
								? {}
								: { details: item.error.details }),
						},
					})),
				});
			} catch (error) {
				return failure(error);
			}
		},
	);

	server.registerTool(
		"inspect_archive",
		{
			description:
				"Detect and summarize one resource without returning its full entry list.",
			inputSchema: z.object({ source: sourceSchema }),
			outputSchema: successOrFailure(
				z.union([
					z.object({ recognized: z.literal(false), source: sourceSchema }),
					z.object({
						recognized: z.literal(true),
						source: sourceSchema,
						size: z.string(),
						format: formatSchema,
						metadata: z.record(z.string(), z.unknown()),
						summary: z.object({
							entryCount: z.number().int().nonnegative(),
							compressedEntries: z.number().int().nonnegative(),
							encryptedEntries: z.number().int().nonnegative(),
							unknownSizeEntries: z.number().int().nonnegative(),
						}),
					}),
				]),
			),
			annotations: readOnly,
		},
		async ({ source }) => {
			try {
				await workspace.prepare({ createOutput: false });
				const result = await automation.inspectArchive(source);
				if (!result.recognized) return success(result);
				return success({
					recognized: true as const,
					source: result.source,
					size: result.size.toString(),
					format: formatToWire(result.format),
					metadata: result.metadata,
					summary: result.summary,
				});
			} catch (error) {
				return failure(error);
			}
		},
	);

	server.registerTool(
		"list_entries",
		{
			description: "List and filter a bounded page of archive entries.",
			inputSchema: z.object({
				source: sourceSchema,
				includeGlobs: z.array(z.string()).max(32).optional(),
				excludeGlobs: z.array(z.string()).max(32).optional(),
				caseSensitive: z.boolean().default(false),
				compressed: z.boolean().optional(),
				encrypted: z.boolean().optional(),
				offset: z.number().int().nonnegative().default(0),
				limit: z.number().int().positive().max(1000).default(100),
			}),
			outputSchema: successOrFailure(
				z.object({
					archiveTotal: z.number().int().nonnegative(),
					matchedTotal: z.number().int().nonnegative(),
					offset: z.number().int().nonnegative(),
					limit: z.number().int().positive(),
					nextOffset: z.number().int().nonnegative().nullable(),
					entries: z.array(entrySchema),
				}),
			),
			annotations: readOnly,
		},
		async ({ source, ...options }) => {
			try {
				await workspace.prepare({ createOutput: false });
				const result = await automation.listEntries(source, {
					caseSensitive: options.caseSensitive,
					offset: options.offset,
					limit: options.limit,
					...(options.includeGlobs === undefined
						? {}
						: { includeGlobs: options.includeGlobs }),
					...(options.excludeGlobs === undefined
						? {}
						: { excludeGlobs: options.excludeGlobs }),
					...(options.compressed === undefined
						? {}
						: { compressed: options.compressed }),
					...(options.encrypted === undefined
						? {}
						: { encrypted: options.encrypted }),
				});
				return success({
					...result,
					entries: result.entries.map(entryToWire),
				});
			} catch (error) {
				return failure(error);
			}
		},
	);

	server.registerTool(
		"read_entry",
		{
			description:
				"Read a bounded prefix of one entry as detected text or hexadecimal bytes.",
			inputSchema: z.object({
				source: sourceSchema,
				entryId: z.string().min(1),
				mode: z.enum(["auto", "text", "hex"]).default("auto"),
				encoding: z.enum(["auto", "utf8", "utf16le", "cp932"]).default("auto"),
				maxBytes: z.number().int().positive().max(65536).optional(),
			}),
			outputSchema: successOrFailure(
				z.object({
					entry: entrySchema,
					preview: z.union([
						z.object({
							kind: z.literal("text"),
							text: z.string(),
							encoding: z.enum(["utf8", "utf16le", "cp932"]),
							bytesRead: z.number().int().nonnegative(),
							truncated: z.boolean(),
						}),
						z.object({
							kind: z.literal("hex"),
							hex: z.string(),
							bytesRead: z.number().int().nonnegative(),
							truncated: z.boolean(),
						}),
					]),
				}),
			),
			annotations: readOnly,
		},
		async ({ source, entryId, ...options }, context) => {
			try {
				await workspace.prepare({ createOutput: false });
				const result = await automation.previewEntry(source, entryId, {
					mode: options.mode,
					encoding: options.encoding,
					...(options.maxBytes === undefined
						? {}
						: { maxBytes: options.maxBytes }),
					signal: context.mcpReq.signal,
				});
				return success({
					entry: entryToWire(result.entry),
					preview: result.preview,
				});
			} catch (error) {
				return failure(error);
			}
		},
	);

	const artifactSchema = z.object({
		relativePath: z.string(),
		absolutePath: z.string(),
		bytesWritten: z.string(),
		sha256: z.string(),
	});
	server.registerTool(
		"extract_entries",
		{
			description:
				"Extract all, explicitly selected, or glob-matched entries beneath the configured output root.",
			inputSchema: z.object({
				source: sourceSchema,
				selection: z
					.discriminatedUnion("mode", [
						z.object({
							mode: z.literal("all"),
							excludeGlobs: z.array(z.string()).max(32).optional(),
						}),
						z.object({
							mode: z.literal("ids"),
							entryIds: z.array(z.string().min(1)).min(1).max(10000),
						}),
						z.object({
							mode: z.literal("glob"),
							includeGlobs: z.array(z.string()).min(1).max(32),
							excludeGlobs: z.array(z.string()).max(32).optional(),
							caseSensitive: z.boolean().default(false),
						}),
					])
					.default({ mode: "all" }),
				outputSubdirectory: z.string().min(1).optional(),
				conflictPolicy: z.enum(["fail", "skip", "overwrite"]).default("fail"),
			}),
			outputSchema: successOrFailure(
				z.object({
					status: z.enum(["completed", "partial", "failed"]),
					outputDirectory: z.string(),
					selected: z.number().int().nonnegative(),
					extracted: z.number().int().nonnegative(),
					skipped: z.number().int().nonnegative(),
					failed: z.number().int().nonnegative(),
					bytesWritten: z.string(),
					items: z.array(
						z.union([
							z.object({
								entryId: z.string(),
								entryPath: z.string(),
								status: z.literal("extracted"),
								artifact: artifactSchema,
							}),
							z.object({
								entryId: z.string(),
								entryPath: z.string().optional(),
								status: z.literal("skipped"),
								reason: z.string(),
							}),
							z.object({
								entryId: z.string(),
								entryPath: z.string().optional(),
								status: z.literal("failed"),
								error: errorSchema,
							}),
						]),
					),
				}),
			),
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
			},
		},
		async ({ source, ...options }, context) => {
			try {
				await workspace.prepare();
				const selection =
					options.selection.mode === "ids"
						? options.selection
						: options.selection.mode === "all"
							? {
									mode: "all" as const,
									...(options.selection.excludeGlobs === undefined
										? {}
										: { excludeGlobs: options.selection.excludeGlobs }),
								}
							: {
									mode: "glob" as const,
									includeGlobs: options.selection.includeGlobs,
									caseSensitive: options.selection.caseSensitive,
									...(options.selection.excludeGlobs === undefined
										? {}
										: { excludeGlobs: options.selection.excludeGlobs }),
								};
				const result = await automation.extractEntries(
					source,
					{
						selection,
						conflictPolicy: options.conflictPolicy,
						...(options.outputSubdirectory === undefined
							? {}
							: { outputSubdirectory: options.outputSubdirectory }),
					},
					toControl(context),
				);
				return success({
					...result,
					bytesWritten: result.bytesWritten.toString(),
					items: result.items.map(batchItemToWire),
				});
			} catch (error) {
				return failure(error);
			}
		},
	);

	return server;
}
