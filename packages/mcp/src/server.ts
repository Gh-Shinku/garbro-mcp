import {
	type ArchiveAutomationOptions,
	ArchiveAutomationService,
	type AutomationControl,
	asGarbroError,
	DEFAULT_AUTOMATION_LIMITS,
	entryToWire,
	type FormatRegistry,
	formatToWire,
	GarbroError,
	readExtractionReport,
	WorkspacePolicy,
	type WorkspacePolicyOptions,
	writeExtractionReport,
} from "@garbro-mcp/core";
import {
	createDefaultRegistry,
	formatSupportCatalog,
} from "@garbro-mcp/formats";
import { McpServer, type ServerContext } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
	boundedPage,
	DEFAULT_RESPONSE_BYTES,
	fitsResponse,
	MAX_RESPONSE_BYTES,
	toolResult,
} from "./context.js";

declare const GARBRO_MCP_VERSION: string;
export const SERVER_VERSION =
	typeof GARBRO_MCP_VERSION === "string" ? GARBRO_MCP_VERSION : "0.0.0";
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
const budgetSchema = z
	.number()
	.int()
	.min(2048)
	.max(MAX_RESPONSE_BYTES)
	.default(DEFAULT_RESPONSE_BYTES);
const detailSchema = z.enum(["summary", "full"]).default("summary");
const formatSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	extensions: z.array(z.string()),
	resourceType: z.enum(resourceTypes).optional(),
	status: z.string().optional(),
	verification: z.string().optional(),
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
	if (!fitsResponse(payload, MAX_RESPONSE_BYTES))
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			"Response exceeds 64 KiB. Request a smaller page or summary detail.",
		);
	return toolResult(payload);
}

function failure(error: unknown) {
	const garbroError = asGarbroError(error);
	const payload = {
		error: {
			code: garbroError.code,
			message: garbroError.message.slice(0, 2048),
		},
	};
	while (
		Buffer.byteLength(
			JSON.stringify({ ...toolResult(payload), isError: true }),
		) > 2048
	)
		payload.error.message = payload.error.message.slice(
			0,
			Math.floor(payload.error.message.length / 2),
		);
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

function entrySummary(entry: Parameters<typeof entryToWire>[0]) {
	return {
		id: entry.id,
		path: entry.path,
		size: entry.size.toString(),
		packedSize: entry.packedSize.toString(),
		compressed: entry.compressed,
		encrypted: entry.encrypted,
		...(entry.sizeKnown === undefined ? {} : { sizeKnown: entry.sizeKnown }),
	};
}

function formatSummary(
	format: Parameters<typeof formatToWire>[0],
	support?: SupportRecord,
) {
	return {
		id: format.id,
		name: format.name,
		extensions: [...format.extensions],
		...(support === undefined
			? {}
			: {
					resourceType: support.reference.type,
					status: support.status,
					verification: support.verification,
				}),
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
		formatId: item.formatId,
		decoderId: item.decoderId,
		error: {
			code: item.error.code,
			message: item.error.message.slice(0, 2048),
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
	const registry =
		options.registry ??
		createDefaultRegistry({
			maxDecodedBytes:
				options.limits?.decodedResourceMaxBytes ??
				DEFAULT_AUTOMATION_LIMITS.decodedResourceMaxBytes,
		});
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
	const server = new McpServer({ name: "garbro-mcp", version: SERVER_VERSION });
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
						decodedResourceMaxBytes: z.number().int().positive(),
						responseDefaultBytes: z.number().int().positive(),
						responseMaxBytes: z.number().int().positive(),
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
						version: SERVER_VERSION,
						transport: "stdio" as const,
					},
					inputRoots: workspace.inputRoots.map((root) => ({ ...root })),
					outputRoot: workspace.outputRoot,
					limits: {
						...automation.limits,
						responseDefaultBytes: DEFAULT_RESPONSE_BYTES,
						responseMaxBytes: MAX_RESPONSE_BYTES,
					},
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
				formatId: z.string().optional(),
				detail: detailSchema,
				maxResponseBytes: budgetSchema,
				status: z.string().optional(),
				extension: z.string().optional(),
				offset: z.number().int().nonnegative().default(0),
				limit: z.number().int().positive().max(1000).default(20),
			}),
			outputSchema: successOrFailure(
				z.object({
					total: z.number().int().nonnegative(),
					offset: z.number().int().nonnegative(),
					limit: z.number().int().positive(),
					nextOffset: z.number().int().nonnegative().nullable(),
					responseTruncated: z.boolean(),
					formats: z.array(
						formatSummarySchema.extend({
							details: formatSchema
								.extend({ support: supportSchema })
								.optional(),
						}),
					),
				}),
			),
			annotations: readOnly,
		},
		async ({
			resourceType,
			formatId,
			detail,
			maxResponseBytes,
			status,
			extension,
			offset,
			limit,
		}) => {
			try {
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
							(formatId === undefined || format.id === formatId) &&
							(resourceType === undefined ||
								support.reference.type === resourceType) &&
							(status === undefined || support.status === status) &&
							(normalizedExtension === undefined ||
								format.extensions.some(
									(candidate) =>
										candidate.toLowerCase() === normalizedExtension,
								)),
					)
					.map(({ format, support }) => ({
						...formatSummary(format, support),
						...(detail === "full"
							? {
									details: {
										...formatToWire(format),
										support: supportToWire(support),
									},
								}
							: {}),
					}));
				const page = formats.slice(offset, offset + limit);
				return success(
					boundedPage(
						page,
						(visible) => ({
							total: formats.length,
							offset,
							limit,
							nextOffset:
								offset + visible.length < formats.length
									? offset + visible.length
									: null,
							responseTruncated: visible.length < page.length,
							formats: visible,
						}),
						maxResponseBytes,
					),
				);
			} catch (error) {
				return failure(error);
			}
		},
	);

	const scanTool = {
		description:
			"Scan a configured input root for validated resources and return a resumable page with support metadata and aggregate counts.",
		inputSchema: z.object({
			rootId: z.string().min(1),
			maxResponseBytes: budgetSchema,
			path: z.string().min(1).default("."),
			recursive: z.boolean().default(true),
			includeGlobs: z.array(z.string()).max(32).optional(),
			excludeGlobs: z.array(z.string()).max(32).optional(),
			maxDepth: z.number().int().min(0).max(64).default(8),
			cursor: z.string().min(1).optional(),
			limit: z.number().int().positive().max(500).default(50),
			includeUnrecognized: z.boolean().default(false),
			resourceTypes: z.array(z.enum(resourceTypes)).max(4).optional(),
			formatIds: z.array(z.string().min(1)).max(128).optional(),
		}),
		outputSchema: successOrFailure(
			z.object({
				scanned: z.number().int().nonnegative(),
				archives: z.array(
					z.object({
						source: sourceSchema,
						size: z.string(),
						formatId: z.string(),
						format: formatSummarySchema,
						validation: z.enum(["signature", "structural", "decoded"]),
						confidence: z.enum(["low", "medium", "high"]),
						warnings: z.array(z.string()),
					}),
				),
				unrecognized: z.array(sourceSchema),
				unrecognizedCount: z.number().int().nonnegative(),
				failures: z.array(
					z.object({ source: sourceSchema, error: errorSchema }),
				),
				nextCursor: z.string().nullable(),
				complete: z.boolean(),
				responseTruncated: z.boolean(),
				counts: z.object({
					recognized: z.number().int().nonnegative(),
					unrecognized: z.number().int().nonnegative(),
					failures: z.number().int().nonnegative(),
					byResourceType: z.record(z.string(), z.number().int().nonnegative()),
					byFormat: z.record(z.string(), z.number().int().nonnegative()),
				}),
			}),
		),
		annotations: readOnly,
	} as const;
	const scanResources = async (
		{ rootId, ...input }: z.infer<typeof scanTool.inputSchema>,
		context: ServerContext,
	) => {
		try {
			await workspace.prepare({ createOutput: false });
			const scanOptions = {
				path: input.path,
				recursive: input.recursive,
				maxDepth: input.maxDepth,
				limit: input.limit,
				includeUnrecognized: true,
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
			const requestedResourceTypes = new Set(input.resourceTypes ?? []);
			const requestedFormatIds = new Set(input.formatIds ?? []);
			const filteredArchives = result.archives.filter((item) => {
				const support = supportById.get(item.format.id);
				return (
					(requestedFormatIds.size === 0 ||
						requestedFormatIds.has(item.format.id)) &&
					(requestedResourceTypes.size === 0 ||
						(support !== undefined &&
							requestedResourceTypes.has(support.reference.type)))
				);
			});
			const byResourceType: Record<string, number> = {};
			const byFormat: Record<string, number> = {};
			for (const item of filteredArchives) {
				byFormat[item.format.id] = (byFormat[item.format.id] ?? 0) + 1;
				const resourceType = supportById.get(item.format.id)?.reference.type;
				if (resourceType !== undefined)
					byResourceType[resourceType] =
						(byResourceType[resourceType] ?? 0) + 1;
			}
			const events = [
				...filteredArchives.map((item) => ({
					kind: "archive" as const,
					source: item.source,
					item,
				})),
				...result.failures.map((item) => ({
					kind: "failure" as const,
					source: item.source,
					item,
				})),
				...result.unrecognized.map((source) => ({
					kind: "unrecognized" as const,
					source,
				})),
			].sort((a, b) =>
				a.source.path < b.source.path
					? -1
					: a.source.path > b.source.path
						? 1
						: 0,
			);
			return success(
				boundedPage(
					events,
					(visible) => {
						const archives: Record<string, unknown>[] = [];
						const failures: Record<string, unknown>[] = [];
						const unrecognized = [];
						for (const event of visible) {
							if (event.kind === "archive")
								archives.push({
									source: event.source,
									size: event.item.size.toString(),
									formatId: event.item.format.id,
									format: formatSummary(
										event.item.format,
										supportById.get(event.item.format.id),
									),
									validation: event.item.validation,
									confidence: event.item.confidence,
									warnings: [...event.item.warnings],
								});
							else if (event.kind === "failure")
								failures.push({
									source: event.source,
									error: {
										code: event.item.error.code,
										message: event.item.error.message.slice(0, 2048),
									},
								});
							else unrecognized.push(event.source);
						}
						const responseTruncated = visible.length < events.length;
						return {
							scanned: result.scanned,
							archives,
							failures,
							unrecognized: input.includeUnrecognized ? unrecognized : [],
							unrecognizedCount: result.unrecognizedCount,
							counts: {
								recognized: filteredArchives.length,
								unrecognized: result.unrecognizedCount,
								failures: result.failures.length,
								byResourceType,
								byFormat,
							},
							responseTruncated,
							complete: result.complete && !responseTruncated,
							nextCursor: responseTruncated
								? Buffer.from(visible.at(-1)?.source.path ?? "").toString(
										"base64url",
									)
								: result.nextCursor,
						};
					},
					input.maxResponseBytes,
				),
			);
		} catch (error) {
			return failure(error);
		}
	};
	server.registerTool("scan_resources", scanTool, scanResources);
	server.registerTool(
		"scan_archives",
		{
			...scanTool,
			description:
				"Compatibility alias for scan_resources. Scan a configured input root for validated resources.",
		},
		scanResources,
	);

	server.registerTool(
		"inspect_archive",
		{
			description:
				"Detect and summarize one resource without returning its full entry list.",
			inputSchema: z.object({
				source: sourceSchema,
				detail: detailSchema,
				maxResponseBytes: budgetSchema,
			}),
			outputSchema: successOrFailure(
				z.union([
					z.object({ recognized: z.literal(false), source: sourceSchema }),
					z.object({
						recognized: z.literal(true),
						source: sourceSchema,
						size: z.string(),
						format: formatSummarySchema,
						validation: z.enum(["signature", "structural", "decoded"]),
						confidence: z.enum(["low", "medium", "high"]),
						warnings: z.array(z.string()),
						metadata: z.record(z.string(), z.unknown()).optional(),
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
		async ({ source, detail, maxResponseBytes }) => {
			try {
				await workspace.prepare({ createOutput: false });
				const result = await automation.inspectArchive(source);
				if (!result.recognized) return success(result);
				const payload = {
					recognized: true as const,
					source: result.source,
					size: result.size.toString(),
					format: formatSummary(
						result.format,
						supportById.get(result.format.id),
					),
					validation: result.validation,
					confidence: result.confidence,
					warnings: [...result.warnings],
					...(detail === "full" ? { metadata: result.metadata } : {}),
					summary: result.summary,
				};
				if (!fitsResponse(payload, maxResponseBytes))
					throw new GarbroError(
						"LIMIT_EXCEEDED",
						"Inspection cannot fit the response budget. Use summary detail.",
					);
				return success(payload);
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
				detail: detailSchema,
				maxResponseBytes: budgetSchema,
				includeGlobs: z.array(z.string()).max(32).optional(),
				excludeGlobs: z.array(z.string()).max(32).optional(),
				caseSensitive: z.boolean().default(false),
				compressed: z.boolean().optional(),
				encrypted: z.boolean().optional(),
				offset: z.number().int().nonnegative().default(0),
				limit: z.number().int().positive().max(1000).default(50),
			}),
			outputSchema: successOrFailure(
				z.object({
					archiveTotal: z.number().int().nonnegative(),
					matchedTotal: z.number().int().nonnegative(),
					offset: z.number().int().nonnegative(),
					limit: z.number().int().positive(),
					nextOffset: z.number().int().nonnegative().nullable(),
					entries: z.array(entrySchema),
					responseTruncated: z.boolean(),
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
				const entries = result.entries.map(
					options.detail === "full" ? entryToWire : entrySummary,
				);
				return success(
					boundedPage(
						entries,
						(visible) => ({
							...result,
							entries: visible,
							nextOffset:
								result.offset + visible.length < result.matchedTotal
									? result.offset + visible.length
									: null,
							responseTruncated: visible.length < entries.length,
						}),
						options.maxResponseBytes,
					),
				);
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
				maxResponseBytes: budgetSchema,
				mode: z.enum(["auto", "text", "hex"]).default("auto"),
				encoding: z.enum(["auto", "utf8", "utf16le", "cp932"]).default("auto"),
				maxBytes: z.number().int().positive().max(65536).optional(),
			}),
			outputSchema: successOrFailure(
				z.object({
					entry: entrySchema,
					responseTruncated: z.boolean(),
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
				const requested =
					options.maxBytes ?? automation.limits.previewDefaultBytes;
				let maxBytes = requested;
				for (;;) {
					const result = await automation.previewEntry(source, entryId, {
						mode: options.mode,
						encoding: options.encoding,
						maxBytes,
						signal: context.mcpReq.signal,
					});
					const payload = {
						entry: entrySummary(result.entry),
						preview: result.preview,
						responseTruncated: maxBytes < requested,
					};
					if (fitsResponse(payload, options.maxResponseBytes))
						return success(payload);
					if (maxBytes === 1)
						throw new GarbroError(
							"LIMIT_EXCEEDED",
							"Entry header cannot fit the response budget.",
						);
					maxBytes = Math.max(1, Math.floor(maxBytes / 2));
				}
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
				"Extract entries with compact counts and a saved report. Always check hasFailures and each item status. Use reportPath instead of source to page the report without extracting again.",
			inputSchema: z.object({
				source: sourceSchema.optional(),
				reportPath: z.string().min(1).optional(),
				offset: z.number().int().nonnegative().default(0),
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
				inline: z.enum(["summary", "errors", "all"]).default("errors"),
				itemLimit: z.number().int().min(0).max(100).default(10),
				maxResponseBytes: budgetSchema,
			}),
			outputSchema: successOrFailure(
				z.object({
					status: z.enum(["completed", "partial", "failed"]),
					hasFailures: z.boolean(),
					outputDirectory: z.string(),
					selected: z.number().int().nonnegative(),
					extracted: z.number().int().nonnegative(),
					skipped: z.number().int().nonnegative(),
					failed: z.number().int().nonnegative(),
					bytesWritten: z.string(),
					report: artifactSchema.optional(),
					reportError: errorSchema.optional(),
					itemsOmitted: z.number().int().nonnegative(),
					responseTruncated: z.boolean(),
					offset: z.number().int().nonnegative(),
					nextOffset: z.number().int().nonnegative().nullable(),
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
								formatId: z.string(),
								decoderId: z.string(),
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
				if ((source === undefined) === (options.reportPath === undefined))
					throw new GarbroError(
						"INVALID_ARGUMENT",
						"Provide exactly one of source or reportPath",
					);
				if (options.reportPath !== undefined) {
					const loaded = await readExtractionReport(
						workspace,
						options.reportPath,
					);
					const stored = z
						.object({
							status: z.enum(["completed", "partial", "failed"]),
							outputDirectory: z.string(),
							selected: z.number().int().nonnegative(),
							extracted: z.number().int().nonnegative(),
							skipped: z.number().int().nonnegative(),
							failed: z.number().int().nonnegative(),
							bytesWritten: z.string(),
							items: z
								.array(
									z
										.object({
											status: z.enum(["extracted", "skipped", "failed"]),
										})
										.passthrough(),
								)
								.max(10000),
						})
						.parse(loaded.report);
					const candidates =
						options.inline === "summary"
							? []
							: stored.items.filter(
									(item) =>
										options.inline === "all" || item.status === "failed",
								);
					if (candidates.length > options.offset && options.itemLimit === 0)
						throw new GarbroError(
							"INVALID_ARGUMENT",
							"Use inline summary for counts only, or a positive itemLimit to page items",
						);
					const page = candidates.slice(
						options.offset,
						options.offset + options.itemLimit,
					);
					return success(
						boundedPage(
							page,
							(visible) => ({
								...stored,
								hasFailures: stored.failed > 0,
								items: visible,
								report: {
									...loaded.artifact,
									bytesWritten: loaded.artifact.bytesWritten.toString(),
								},
								offset: options.offset,
								nextOffset:
									options.offset + visible.length < candidates.length
										? options.offset + visible.length
										: null,
								itemsOmitted: Math.max(0, stored.selected - visible.length),
								responseTruncated: visible.length < stored.selected,
							}),
							options.maxResponseBytes,
						),
					);
				}
				if (source === undefined || options.offset !== 0)
					throw new GarbroError(
						"INVALID_ARGUMENT",
						"Extraction requires source and offset 0; use reportPath to continue a report",
					);
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
				let report: Record<string, unknown> | undefined;
				let reportError:
					| { code: (typeof errorCodes)[number]; message: string }
					| undefined;
				try {
					const artifact = await writeExtractionReport(workspace, result);
					report = {
						...artifact,
						bytesWritten: artifact.bytesWritten.toString(),
					};
				} catch (error) {
					const converted = asGarbroError(error);
					reportError = {
						code: converted.code,
						message: converted.message.slice(0, 2048),
					};
				}
				const candidates =
					options.inline === "summary"
						? []
						: result.items.filter(
								(item) => options.inline === "all" || item.status === "failed",
							);
				const inlineItems = candidates
					.slice(0, options.itemLimit)
					.map(batchItemToWire);
				return success(
					boundedPage(
						inlineItems,
						(visible) => ({
							status: result.status,
							hasFailures: result.hasFailures,
							outputDirectory: result.outputDirectory,
							selected: result.selected,
							extracted: result.extracted,
							skipped: result.skipped,
							failed: result.failed,
							bytesWritten: result.bytesWritten.toString(),
							...(report === undefined ? {} : { report }),
							...(reportError === undefined ? {} : { reportError }),
							itemsOmitted: result.selected - visible.length,
							responseTruncated: visible.length < result.selected,
							offset: 0,
							nextOffset:
								visible.length < candidates.length ? visible.length : null,
							items: visible,
						}),
						options.maxResponseBytes,
						true,
					),
				);
			} catch (error) {
				return failure(error);
			}
		},
	);

	const batchItemSchema = z.union([
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
			formatId: z.string(),
			decoderId: z.string(),
			error: errorSchema,
		}),
	]);
	const batchSourceSchema = z.object({
		source: sourceSchema,
		status: z.enum(["completed", "partial", "failed"]),
		hasFailures: z.boolean(),
		outputDirectory: z.string().optional(),
		selected: z.number().int().nonnegative(),
		extracted: z.number().int().nonnegative(),
		skipped: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		bytesWritten: z.string(),
		report: artifactSchema.optional(),
		reportError: errorSchema.optional(),
		itemsOmitted: z.number().int().nonnegative(),
		items: z.array(batchItemSchema),
	});
	server.registerTool(
		"extract_resources",
		{
			description:
				"Extract several resources in one bounded batch. Review each source result and hasFailures; every completed source gets its own hashed report.",
			inputSchema: z.object({
				sources: z.array(sourceSchema).min(1).max(32),
				inline: z.enum(["summary", "errors", "all"]).default("errors"),
				itemLimit: z.number().int().min(0).max(100).default(10),
				conflictPolicy: z.enum(["fail", "skip", "overwrite"]).default("fail"),
				offset: z.number().int().nonnegative().default(0),
				limit: z.number().int().positive().max(32).default(8),
				maxResponseBytes: budgetSchema,
			}),
			outputSchema: successOrFailure(
				z.object({
					totalSources: z.number().int().nonnegative(),
					offset: z.number().int().nonnegative(),
					nextOffset: z.number().int().nonnegative().nullable(),
					responseTruncated: z.boolean(),
					status: z.enum(["completed", "partial", "failed"]),
					hasFailures: z.boolean(),
					selected: z.number().int().nonnegative(),
					extracted: z.number().int().nonnegative(),
					skipped: z.number().int().nonnegative(),
					failed: z.number().int().nonnegative(),
					bytesWritten: z.string(),
					sources: z.array(batchSourceSchema),
				}),
			),
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
			},
		},
		async (
			{
				sources,
				inline,
				itemLimit,
				conflictPolicy,
				offset,
				limit,
				maxResponseBytes,
			},
			context,
		) => {
			try {
				await workspace.prepare();
				const results: Array<Record<string, unknown>> = [];
				for (const source of sources) {
					try {
						const result = await automation.extractEntries(
							source,
							{ conflictPolicy },
							toControl(context),
						);
						let report: Record<string, unknown> | undefined;
						let reportError:
							| { code: (typeof errorCodes)[number]; message: string }
							| undefined;
						try {
							const artifact = await writeExtractionReport(workspace, result);
							report = {
								...artifact,
								bytesWritten: artifact.bytesWritten.toString(),
							};
						} catch (error) {
							const converted = asGarbroError(error);
							reportError = {
								code: converted.code,
								message: converted.message.slice(0, 2048),
							};
						}
						const candidates =
							inline === "summary"
								? []
								: result.items.filter(
										(item) => inline === "all" || item.status === "failed",
									);
						const visible = candidates.slice(0, itemLimit).map(batchItemToWire);
						results.push({
							source,
							status: result.status,
							hasFailures: result.hasFailures,
							outputDirectory: result.outputDirectory,
							selected: result.selected,
							extracted: result.extracted,
							skipped: result.skipped,
							failed: result.failed,
							bytesWritten: result.bytesWritten.toString(),
							...(report === undefined ? {} : { report }),
							...(reportError === undefined ? {} : { reportError }),
							itemsOmitted: Math.max(0, candidates.length - visible.length),
							items: visible,
						});
					} catch (error) {
						if (context.mcpReq.signal.aborted) throw error;
						const converted = asGarbroError(error);
						results.push({
							source,
							status: "failed",
							hasFailures: true,
							selected: 0,
							extracted: 0,
							skipped: 0,
							failed: 1,
							bytesWritten: "0",
							itemsOmitted: 0,
							items: [],
							reportError: {
								code: converted.code,
								message: converted.message.slice(0, 2048),
							},
						});
					}
				}
				const page = results.slice(offset, offset + limit);
				const selected = results.reduce(
					(total, result) => total + Number(result.selected),
					0,
				);
				const extracted = results.reduce(
					(total, result) => total + Number(result.extracted),
					0,
				);
				const skipped = results.reduce(
					(total, result) => total + Number(result.skipped),
					0,
				);
				const failed = results.reduce(
					(total, result) => total + Number(result.failed),
					0,
				);
				const bytesWritten = results.reduce(
					(total, result) => total + BigInt(String(result.bytesWritten)),
					0n,
				);
				return success(
					boundedPage(
						page,
						(visible) => ({
							totalSources: results.length,
							offset,
							nextOffset:
								offset + visible.length < results.length
									? offset + visible.length
									: null,
							responseTruncated: visible.length < page.length,
							status:
								failed === 0
									? "completed"
									: extracted > 0 || skipped > 0
										? "partial"
										: "failed",
							hasFailures: failed > 0,
							selected,
							extracted,
							skipped,
							failed,
							bytesWritten: bytesWritten.toString(),
							sources: visible,
						}),
						maxResponseBytes,
					),
				);
			} catch (error) {
				return failure(error);
			}
		},
	);

	return server;
}
