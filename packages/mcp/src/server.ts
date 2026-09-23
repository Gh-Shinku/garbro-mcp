import {
	type ArchiveAutomationOptions,
	ArchiveAutomationService,
	AsyncJobManager,
	type AutomationControl,
	asGarbroError,
	DEFAULT_AUTOMATION_LIMITS,
	entryToWire,
	type ExtractionSelection,
	type FormatRegistry,
	formatToWire,
	GarbroError,
	readExtractionReport,
	ResourceCatalogIndex,
	type ResourceAlias,
	entryResourceTypes,
	WorkspacePolicy,
	type WorkspacePolicyOptions,
	verifyArtifact,
	writeExtractionReport,
} from "@garbro-mcp/core";
import {
	createDefaultRegistry,
	formatSupportCatalog,
} from "@garbro-mcp/formats";
import {
	canonicalJson,
	createDefaultVocabularyRegistry,
	type LoadedSemanticCatalog,
	readSemanticCatalog,
	SemanticCatalogIndex,
	type SemanticQuery,
	type SemanticRecord,
} from "@garbro-mcp/semantic";
import { McpServer, type ServerContext } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
	boundedPage,
	DEFAULT_RESPONSE_BYTES,
	fitsResponse,
	MAX_RESPONSE_BYTES,
	toolResult,
} from "./context.js";
import { BUILD_IDENTITY } from "./build.js";

export const SERVER_VERSION = BUILD_IDENTITY.version;
export const SERVER_PURPOSE =
	"Detect, inspect, decode, extract, and verify supported game resource formats.";
export const SERVER_SCOPE = [
	"known archive and resource formats",
	"bounded metadata inspection",
	"safe planned extraction",
	"artifact verification",
	"externally supplied resource mappings",
] as const;
export const SERVER_NON_CAPABILITIES = [
	"game logic reverse engineering",
	"automatic adaptation to unknown engines",
	"character, dialogue, voice, or sprite inference",
	"executable decompilation",
	"automatic semantic mapping",
] as const;
export const SERVER_INSTRUCTIONS = `${SERVER_PURPOSE}

Use garbro-mcp for deterministic resource access: scan known files, inspect archives, classify entries, plan extraction, extract, and verify artifacts. It may query mappings explicitly supplied by the user or another external analysis tool.

Do not delegate game-logic reverse engineering, executable decompilation, unknown-engine adaptation, or character/dialogue/voice/sprite inference to this server. If a request needs a relationship that is not present in a configured mapping, report that the resource bytes may be extractable but the mapping requires external analysis or user input. Never infer semantic ownership from filenames alone.`;
const resourceTypes = ["archive", "image", "audio", "script"] as const;
const errorCodes = [
	"INVALID_ARCHIVE",
	"INVALID_ARGUMENT",
	"UNSUPPORTED_FEATURE",
	"ENTRY_NOT_FOUND",
	"UNSAFE_PATH",
	"OUTPUT_EXISTS",
	"PLAN_CHANGED",
	"LIMIT_EXCEEDED",
	"CANCELLED",
	"IO_ERROR",
] as const;

const errorSchema = z.object({
	code: z.enum(errorCodes),
	message: z.string(),
	details: z.record(z.string(), z.unknown()).optional(),
});
const outcomeSchema = z.object({
	status: z.enum(["ok", "partial", "unsupported", "ambiguous", "failed"]),
	warnings: z.array(z.string()),
	nextAction: z
		.object({
			code: z.string(),
			message: z.string(),
		})
		.optional(),
	verification: z
		.object({
			level: z.enum(["none", "signature", "structural", "decoded", "manifest"]),
			evidence: z.array(z.record(z.string(), z.unknown())),
		})
		.optional(),
});
const failureSchema = z.object({ outcome: outcomeSchema, error: errorSchema });
const sourceSchema = z.object({
	rootId: z.string().min(1),
	path: z.string().min(1),
});
const decimalBytesSchema = z.string().regex(/^[1-9]\d*$/);
const semanticNameSchema = z.string().regex(/^[^:]+:[^:]+$/);
const assertionStatuses = [
	"verified",
	"user-confirmed",
	"candidate",
	"conflicted",
	"rejected",
	"unresolved",
] as const;
const extractionSelectionSchema = z.discriminatedUnion("mode", [
	z.object({
		mode: z.literal("all"),
		excludeGlobs: z.array(z.string()).max(32).optional(),
		resourceTypes: z.array(z.enum(entryResourceTypes)).min(1).optional(),
	}),
	z.object({
		mode: z.literal("ids"),
		entryIds: z.array(z.string().min(1)).min(1).max(10000),
		resourceTypes: z.array(z.enum(entryResourceTypes)).min(1).optional(),
	}),
	z.object({
		mode: z.literal("glob"),
		includeGlobs: z.array(z.string()).min(1).max(32),
		excludeGlobs: z.array(z.string()).max(32).optional(),
		caseSensitive: z.boolean().default(false),
		resourceTypes: z.array(z.enum(entryResourceTypes)).min(1).optional(),
	}),
]);
const extractionBudgetsSchema = z.object({
	maxResources: z.number().int().positive().max(10000).optional(),
	maxInputBytes: decimalBytesSchema.optional(),
	maxOutputBytes: decimalBytesSchema.optional(),
	maxDecodedBytesPerResource: decimalBytesSchema.optional(),
	timeoutMs: z.number().int().positive().max(3_600_000).optional(),
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
	resourceType: z.enum(entryResourceTypes),
	checksum: z
		.object({ algorithm: z.literal("adler32"), value: z.string() })
		.optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});
const successOrFailure = <T extends z.ZodType>(schema: T) =>
	z.union([
		z.intersection(schema, z.object({ outcome: outcomeSchema })),
		failureSchema,
	]);

type Outcome = z.infer<typeof outcomeSchema>;

function inferOutcome(payload: Record<string, unknown>): Outcome {
	const status =
		payload.recognized === false || payload.status === "unsupported"
			? "unsupported"
			: payload.status === "ambiguous"
				? "ambiguous"
				: payload.status === "failed"
					? "failed"
					: payload.status === "partial" || payload.hasFailures === true
						? "partial"
						: "ok";
	const warnings = Array.isArray(payload.warnings)
		? payload.warnings.filter(
				(warning): warning is string => typeof warning === "string",
			)
		: [];
	const nextAction =
		typeof payload.nextAction === "string"
			? {
					code:
						status === "unsupported"
							? "provide_metadata_or_supported_resource"
							: status === "ambiguous"
								? "narrow_selection"
								: "review_result",
					message: payload.nextAction,
				}
			: status === "failed"
				? {
						code: "inspect_error",
						message: "Inspect the structured error and retry safely.",
					}
				: status === "partial"
					? {
							code: "review_failures",
							message: "Review failed items before continuing.",
						}
					: undefined;
	const validation = payload.validation;
	const verification: Outcome["verification"] =
		validation === "signature" ||
		validation === "structural" ||
		validation === "decoded"
			? {
					level: validation,
					evidence: [
						{
							validation,
							...(typeof payload.confidence === "string"
								? { confidence: payload.confidence }
								: {}),
						},
					],
				}
			: undefined;
	return {
		status,
		warnings,
		...(nextAction === undefined ? {} : { nextAction }),
		...(verification === undefined ? {} : { verification }),
	};
}

function success<const T extends Record<string, unknown>>(
	payload: T,
	outcome: Outcome = inferOutcome(payload),
) {
	const result = { ...payload, outcome };
	if (!fitsResponse(result, MAX_RESPONSE_BYTES))
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			"Response exceeds 64 KiB. Request a smaller page or summary detail.",
		);
	return {
		...toolResult(result),
		...(outcome.status === "failed" ? { isError: true } : {}),
	};
}

function budgetsFromWire(
	budgets: z.infer<typeof extractionBudgetsSchema> | undefined,
) {
	if (budgets === undefined) return undefined;
	return {
		...(budgets.maxResources === undefined
			? {}
			: { maxResources: budgets.maxResources }),
		...(budgets.maxInputBytes === undefined
			? {}
			: { maxInputBytes: BigInt(budgets.maxInputBytes) }),
		...(budgets.maxOutputBytes === undefined
			? {}
			: { maxOutputBytes: BigInt(budgets.maxOutputBytes) }),
		...(budgets.maxDecodedBytesPerResource === undefined
			? {}
			: {
					maxDecodedBytesPerResource: BigInt(
						budgets.maxDecodedBytesPerResource,
					),
				}),
		...(budgets.timeoutMs === undefined
			? {}
			: { timeoutMs: budgets.timeoutMs }),
	};
}

function selectionFromWire(
	selection: z.infer<typeof extractionSelectionSchema>,
): ExtractionSelection {
	if (selection.mode === "ids")
		return {
			mode: "ids",
			entryIds: selection.entryIds,
			...(selection.resourceTypes === undefined
				? {}
				: { resourceTypes: selection.resourceTypes }),
		};
	if (selection.mode === "all")
		return {
			mode: "all",
			...(selection.excludeGlobs === undefined
				? {}
				: { excludeGlobs: selection.excludeGlobs }),
			...(selection.resourceTypes === undefined
				? {}
				: { resourceTypes: selection.resourceTypes }),
		};
	return {
		mode: "glob",
		includeGlobs: selection.includeGlobs,
		caseSensitive: selection.caseSensitive,
		...(selection.excludeGlobs === undefined
			? {}
			: { excludeGlobs: selection.excludeGlobs }),
		...(selection.resourceTypes === undefined
			? {}
			: { resourceTypes: selection.resourceTypes }),
	};
}

function failure(error: unknown) {
	const garbroError = asGarbroError(error);
	const errorPayload: {
		code: (typeof errorCodes)[number];
		message: string;
		details?: Record<string, unknown>;
	} = {
		code: garbroError.code,
		message: garbroError.message.slice(0, 2048),
		...(garbroError.details === undefined
			? {}
			: { details: garbroError.details }),
	};
	const payload = {
		outcome: {
			status: "failed" as const,
			warnings: [],
			nextAction: {
				code: "inspect_error",
				message: "Inspect the structured error and retry safely.",
			},
		},
		error: errorPayload,
	};
	while (
		payload.error.message.length > 0 &&
		Buffer.byteLength(
			JSON.stringify({ ...toolResult(payload), isError: true }),
		) > 2048
	)
		payload.error.message = payload.error.message.slice(
			0,
			Math.floor(payload.error.message.length / 2),
		);
	if (
		Buffer.byteLength(
			JSON.stringify({ ...toolResult(payload), isError: true }),
		) > 2048
	)
		delete payload.error.details;
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
		resourceType: entryToWire(entry).resourceType,
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

type AsyncExtractionPayload = {
	result: ExtractionResult;
	report?: Record<string, unknown>;
	reportError?: { code: (typeof errorCodes)[number]; message: string };
};

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
	resourceAliases?: readonly ResourceAlias[];
	resourceMappingRecords?: readonly SemanticRecord[];
	resourceMappingCatalogs?: readonly LoadedSemanticCatalog[];
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
			...(options.outputRoots === undefined
				? {}
				: { outputRoots: options.outputRoots }),
			...(options.workingDirectory === undefined
				? {}
				: { workingDirectory: options.workingDirectory }),
		});
	const automation = new ArchiveAutomationService(registry, workspace, {
		...(options.limits === undefined ? {} : { limits: options.limits }),
	});
	const extractionJobs = new AsyncJobManager<AsyncExtractionPayload>();
	const supportById = new Map<string, SupportRecord>(
		(formatSupportCatalog.implementations as readonly SupportRecord[]).map(
			(support) => [support.localId, support],
		),
	);
	const configuredInputRoots = new Set(
		workspace.inputRoots.map((root) => root.id),
	);
	for (const resource of options.resourceAliases ?? [])
		if (!configuredInputRoots.has(resource.locator.source.rootId))
			throw new GarbroError(
				"INVALID_ARGUMENT",
				`Resource catalog uses unknown input root: ${resource.locator.source.rootId}`,
			);
	const resourceCatalog = new ResourceCatalogIndex(
		options.resourceAliases ?? [],
	);
	const semanticRecordMap = new Map<string, SemanticRecord>();
	for (const record of options.resourceMappingRecords ?? []) {
		const existing = semanticRecordMap.get(record.id);
		if (
			existing &&
			canonicalJson(existing as never) !== canonicalJson(record as never)
		)
			throw new GarbroError(
				"INVALID_ARGUMENT",
				`Conflicting configured resource-mapping record ID: ${record.id}`,
			);
		semanticRecordMap.set(record.id, record);
	}
	const semanticRecords = [...semanticRecordMap.values()];
	const semanticCatalogs = [...(options.resourceMappingCatalogs ?? [])];
	for (const record of semanticRecords)
		if (
			record.kind === "resource" &&
			!configuredInputRoots.has(record.locator.source.rootId)
		)
			throw new GarbroError(
				"INVALID_ARGUMENT",
				`Resource mapping uses unknown input root: ${record.locator.source.rootId}`,
			);
	const semanticVocabularies = createDefaultVocabularyRegistry();
	const configuredSemanticIndex = new SemanticCatalogIndex();
	for (const record of semanticRecords) configuredSemanticIndex.add(record);
	const server = new McpServer(
		{ name: "garbro-mcp", version: SERVER_VERSION },
		{ instructions: SERVER_INSTRUCTIONS },
	);
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
					purpose: z.string(),
					scope: z.array(z.string()),
					notSupported: z.array(z.string()),
					mappingPolicy: z.literal("external-evidence-only"),
					server: z.object({
						name: z.literal("garbro-mcp"),
						version: z.string(),
						transport: z.literal("stdio"),
						gitCommit: z.string(),
						builtAt: z.string(),
						buildId: z.string(),
						formatCatalogSha256: z.string(),
						resourceMappingCatalogSha256: z.string(),
						dirty: z.boolean(),
						protocolVersion: z.string(),
					}),
					inputRoots: z.array(z.object({ id: z.string(), path: z.string() })),
					outputRoot: z.string(),
					outputRoots: z.array(z.object({ id: z.string(), path: z.string() })),
					limits: z.object({
						decodedResourceMaxBytes: z.number().int().positive(),
						responseDefaultBytes: z.number().int().positive(),
						responseMaxBytes: z.number().int().positive(),
						scanPageMax: z.number().int().positive(),
						entryPageMax: z.number().int().positive(),
						maxBatchEntries: z.number().int().positive(),
						scanConcurrency: z.number().int().positive(),
					}),
					capabilities: z.object({
						resourceTypes: z.array(z.enum(resourceTypes)),
						entryResourceTypes: z.array(z.enum(entryResourceTypes)),
						conflictPolicies: z.array(z.enum(["fail", "skip", "overwrite"])),
						archiveCreation: z.literal(false),
						resourceCatalogEntries: z.number().int().nonnegative(),
						resourceMappings: z.object({
							vocabularies: z.record(z.string(), z.number().int().positive()),
							configuredRecords: z.number().int().nonnegative(),
							configuredCatalogs: z.number().int().nonnegative(),
							policy: z.literal("external-evidence-only"),
						}),
					}),
				}),
			),
			annotations: readOnly,
		},
		async () => {
			try {
				await workspace.prepare({ createOutput: false });
				return success({
					purpose: SERVER_PURPOSE,
					scope: [...SERVER_SCOPE],
					notSupported: [...SERVER_NON_CAPABILITIES],
					mappingPolicy: "external-evidence-only" as const,
					server: {
						name: "garbro-mcp" as const,
						...BUILD_IDENTITY,
						transport: "stdio" as const,
					},
					inputRoots: workspace.inputRoots.map((root) => ({ ...root })),
					outputRoot: workspace.outputRoot,
					outputRoots: workspace.outputRoots.map((root) => ({ ...root })),
					limits: {
						...automation.limits,
						responseDefaultBytes: DEFAULT_RESPONSE_BYTES,
						responseMaxBytes: MAX_RESPONSE_BYTES,
					},
					capabilities: {
						resourceTypes,
						entryResourceTypes: [...entryResourceTypes],
						conflictPolicies: ["fail", "skip", "overwrite"] as const,
						archiveCreation: false as const,
						resourceCatalogEntries: resourceCatalog.resources.length,
						resourceMappings: {
							vocabularies: semanticVocabularies.versions(),
							configuredRecords: semanticRecords.length,
							configuredCatalogs: semanticCatalogs.length,
							policy: "external-evidence-only" as const,
						},
					},
				});
			} catch (error) {
				return failure(error);
			}
		},
	);

	server.registerTool(
		"query_resource_mappings",
		{
			description:
				"Query only externally supplied or previously verified resource mappings. This tool does not infer game semantics, reverse-engineer game logic, or create mappings.",
			inputSchema: z.object({
				entityType: semanticNameSchema.optional(),
				predicate: semanticNameSchema.optional(),
				query: z.string().optional(),
				resourceType: z.string().min(1).optional(),
				statuses: z.array(z.enum(assertionStatuses)).min(1).optional(),
				catalogPath: z.string().min(1).optional(),
				outputRootId: z.string().min(1).optional(),
				gameFingerprint: z
					.string()
					.regex(/^[0-9a-f]{64}$/)
					.optional(),
				includeEvidence: z.boolean().default(false),
				offset: z.number().int().nonnegative().default(0),
				limit: z.number().int().positive().max(1000).default(100),
				maxResponseBytes: budgetSchema,
			}),
			outputSchema: successOrFailure(
				z.object({
					status: z.enum(["resolved", "ambiguous", "unsupported"]),
					reason: z
						.enum(["missing_resource_mapping", "unverified_resource_mapping"])
						.optional(),
					nextAction: z.string().optional(),
					warnings: z.array(z.string()),
					totalNodes: z.number().int().nonnegative(),
					totalRelations: z.number().int().nonnegative(),
					offset: z.number().int().nonnegative(),
					limit: z.number().int().positive(),
					nextOffset: z.number().int().nonnegative().nullable(),
					responseTruncated: z.boolean(),
					nodes: z.array(z.record(z.string(), z.unknown())),
					relations: z.array(z.record(z.string(), z.unknown())),
					resources: z.array(z.record(z.string(), z.unknown())),
					evidence: z.array(z.record(z.string(), z.unknown())).optional(),
				}),
			),
			annotations: readOnly,
		},
		async ({
			includeEvidence,
			offset,
			limit,
			maxResponseBytes,
			catalogPath,
			outputRootId,
			gameFingerprint,
			...query
		}) => {
			try {
				if (catalogPath === undefined && outputRootId !== undefined)
					throw new GarbroError(
						"INVALID_ARGUMENT",
						"outputRootId requires catalogPath",
					);
				const selectedCatalogs =
					catalogPath === undefined
						? semanticCatalogs.filter(
								(catalog) =>
									gameFingerprint === undefined ||
									catalog.header.game.fingerprint === gameFingerprint,
							)
						: [
								await readSemanticCatalog(
									(
										await workspace.resolveOutputArtifact(
											catalogPath,
											outputRootId,
										)
									).absolutePath,
									semanticVocabularies,
								),
							];
				if (
					gameFingerprint !== undefined &&
					selectedCatalogs.some(
						(catalog) => catalog.header.game.fingerprint !== gameFingerprint,
					)
				)
					throw new GarbroError(
						"INVALID_ARGUMENT",
						"Resource-mapping catalog game fingerprint does not match",
					);
				const indexes = [
					...(catalogPath === undefined ? [configuredSemanticIndex] : []),
					...selectedCatalogs.map((catalog) => catalog.index),
				];
				const nodes = new Map<string, SemanticRecord>();
				const relations = new Map<string, SemanticRecord>();
				for (const index of indexes) {
					const result = index.query(
						query as SemanticQuery,
						semanticVocabularies,
					);
					for (const node of result.nodes) nodes.set(node.id, node);
					for (const relation of result.relations)
						relations.set(relation.id, relation);
				}
				const allRelations = [...relations.values()].sort((left, right) =>
					left.id.localeCompare(right.id),
				);
				const allNodes = [...nodes.values()].sort((left, right) =>
					left.id.localeCompare(right.id),
				);
				const allItems =
					allRelations.length > 0 || query.predicate !== undefined
						? allRelations
						: allNodes;
				const hasUnverifiedRelations = allRelations.some(
					(record) =>
						record.kind === "relation" &&
						record.status !== "verified" &&
						record.status !== "user-confirmed",
				);
				const mappingStatus =
					allItems.length === 0
						? ("unsupported" as const)
						: hasUnverifiedRelations
							? ("ambiguous" as const)
							: ("resolved" as const);
				const page = allItems.slice(offset, offset + limit);
				return success(
					boundedPage(
						page,
						(visible) => {
							const visibleRelations = visible.filter(
								(record) => record.kind === "relation",
							);
							const relatedNodes = new Map<string, SemanticRecord>();
							for (const record of visible)
								if (record.kind === "entity" || record.kind === "resource")
									relatedNodes.set(record.id, record);
							const referencedIds = new Set<string>();
							for (const relation of visibleRelations) {
								referencedIds.add(relation.subject);
								if (relation.object.kind === "entity")
									referencedIds.add(relation.object.id);
							}
							for (const index of indexes)
								for (const id of referencedIds) {
									const node = index.nodes.get(id);
									if (node) relatedNodes.set(id, node);
								}
							const evidence = includeEvidence
								? visibleRelations.flatMap((relation) =>
										relation.evidenceIds.flatMap((id) =>
											indexes.flatMap((index) => {
												const item = index.evidence.get(id);
												return item ? [item] : [];
											}),
										),
									)
								: undefined;
							return {
								status: mappingStatus,
								warnings: hasUnverifiedRelations
									? [
											"Unverified mapping assertions are informational and must not drive extraction until confirmed externally.",
										]
									: [],
								...(mappingStatus === "unsupported"
									? {
											reason: "missing_resource_mapping" as const,
											nextAction:
												"Provide a user-confirmed mapping or perform game-logic analysis outside garbro-mcp; this server will not infer the relationship.",
										}
									: mappingStatus === "ambiguous"
										? {
												reason: "unverified_resource_mapping" as const,
												nextAction:
													"Confirm the mapping outside garbro-mcp or supply a user-confirmed replacement before extraction.",
											}
										: {}),
								totalNodes: allNodes.length,
								totalRelations: allRelations.length,
								offset,
								limit,
								nextOffset:
									offset + visible.length < allItems.length
										? offset + visible.length
										: null,
								responseTruncated: visible.length < page.length,
								nodes: [...relatedNodes.values()].filter(
									(record) => record.kind !== "resource",
								),
								relations: visibleRelations,
								resources: [...relatedNodes.values()].filter(
									(record) => record.kind === "resource",
								),
								...(evidence === undefined ? {} : { evidence }),
							};
						},
						maxResponseBytes,
						true,
					),
				);
			} catch (error) {
				return failure(error);
			}
		},
	);

	server.registerTool(
		"search_resources",
		{
			description:
				"Search an optional user-supplied alias catalog. Results state whether resolution is exact, ambiguous, or unsupported; this tool never guesses titles from opaque filenames.",
			inputSchema: z.object({
				query: z.string().trim().min(1),
				rootId: z.string().min(1).optional(),
				locale: z.string().min(1).optional(),
				minDurationSeconds: z.number().nonnegative().optional(),
				maxDurationSeconds: z.number().nonnegative().optional(),
				limit: z.number().int().positive().max(100).default(20),
				maxResponseBytes: budgetSchema,
			}),
			outputSchema: successOrFailure(
				z.object({
					status: z.enum(["resolved", "ambiguous", "unsupported"]),
					reason: z.literal("missing_resource_mapping").optional(),
					total: z.number().int().nonnegative(),
					resultsOmitted: z.number().int().nonnegative(),
					responseTruncated: z.boolean(),
					nextAction: z.string().optional(),
					results: z.array(
						z.object({
							aliases: z.array(z.string()),
							locale: z.string().optional(),
							locator: z.object({
								source: sourceSchema,
								entryId: z.string().optional(),
							}),
							metadata: z
								.object({
									title: z.string().optional(),
									durationSeconds: z.number().optional(),
									codec: z.string().optional(),
									channels: z.number().int().positive().optional(),
								})
								.optional(),
							expected: z
								.object({
									sha256: z.string().optional(),
									decodedSha256: z.string().optional(),
								})
								.optional(),
							matchedBy: z.enum(["alias", "title", "path"]),
							matchedValue: z.string(),
							exact: z.boolean(),
						}),
					),
				}),
			),
			annotations: readOnly,
		},
		async ({ query, limit, maxResponseBytes, ...filters }) => {
			try {
				if (
					filters.minDurationSeconds !== undefined &&
					filters.maxDurationSeconds !== undefined &&
					filters.minDurationSeconds > filters.maxDurationSeconds
				)
					throw new GarbroError(
						"INVALID_ARGUMENT",
						"minDurationSeconds must not exceed maxDurationSeconds",
					);
				const matches = resourceCatalog.search(query, {
					...(filters.rootId === undefined ? {} : { rootId: filters.rootId }),
					...(filters.locale === undefined ? {} : { locale: filters.locale }),
					...(filters.minDurationSeconds === undefined
						? {}
						: { minDurationSeconds: filters.minDurationSeconds }),
					...(filters.maxDurationSeconds === undefined
						? {}
						: { maxDurationSeconds: filters.maxDurationSeconds }),
				});
				const candidates = matches.slice(0, limit).map((match) => ({
					aliases: [...match.resource.aliases],
					...(match.resource.locale === undefined
						? {}
						: { locale: match.resource.locale }),
					locator: match.resource.locator,
					...(match.resource.metadata === undefined
						? {}
						: { metadata: match.resource.metadata }),
					...(match.resource.expected === undefined
						? {}
						: { expected: match.resource.expected }),
					matchedBy: match.matchedBy,
					matchedValue: match.matchedValue,
					exact: match.exact,
				}));
				const status =
					matches.length === 1 && matches[0]?.exact
						? "resolved"
						: matches.length === 0
							? "unsupported"
							: "ambiguous";
				return success(
					boundedPage(
						candidates,
						(visible) => ({
							status,
							total: matches.length,
							resultsOmitted: matches.length - visible.length,
							responseTruncated: visible.length < matches.length,
							...(status === "unsupported"
								? {
										reason: "missing_resource_mapping" as const,
										nextAction:
											"Provide an external alias mapping, or scan extractable resources by path and metadata; garbro-mcp will not infer the title or ownership.",
									}
								: status === "ambiguous"
									? {
											nextAction:
												"Narrow by root, locale, duration, or choose a returned locator explicitly.",
										}
									: {}),
							results: visible,
						}),
						maxResponseBytes,
						true,
					),
				);
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
				resourceTypes: z.array(z.enum(entryResourceTypes)).min(1).optional(),
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
					...(options.resourceTypes === undefined
						? {}
						: { resourceTypes: options.resourceTypes }),
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

	const planItemSchema = z.object({
		entryId: z.string(),
		entryPath: z.string().optional(),
		packedBytes: z.string().optional(),
		outputBytes: z.string().optional(),
		decodedBytes: z.string().optional(),
		status: z.enum(["ready", "skipped", "failed"]),
		reason: z.string().optional(),
		error: errorSchema.optional(),
	});
	server.registerTool(
		"plan_extraction",
		{
			description:
				"Preflight one extraction without writing files. Returns exact known costs, conflicts, budget findings, and a digest that execution can require.",
			inputSchema: z.object({
				source: sourceSchema,
				selection: extractionSelectionSchema.default({ mode: "all" }),
				outputRootId: z.string().min(1).optional(),
				outputSubdirectory: z.string().min(1).optional(),
				conflictPolicy: z.enum(["fail", "skip", "overwrite"]).default("fail"),
				budgets: extractionBudgetsSchema.optional(),
				inline: z.enum(["summary", "all"]).default("summary"),
				itemLimit: z.number().int().min(0).max(100).default(20),
				maxResponseBytes: budgetSchema,
			}),
			outputSchema: successOrFailure(
				z.object({
					source: sourceSchema,
					formatId: z.string(),
					outputRootId: z.string(),
					outputDirectory: z.string(),
					selected: z.number().int().nonnegative(),
					ready: z.number().int().nonnegative(),
					skipped: z.number().int().nonnegative(),
					failed: z.number().int().nonnegative(),
					inputBytes: z.string(),
					outputBytes: z.string().nullable(),
					unknownOutputSizes: z.number().int().nonnegative(),
					budgetViolations: z.array(
						z.object({
							budget: z.enum([
								"maxResources",
								"maxInputBytes",
								"maxOutputBytes",
								"maxDecodedBytesPerResource",
							]),
							actual: z.string(),
							limit: z.string(),
						}),
					),
					budgetUnknowns: z.array(
						z.enum(["maxOutputBytes", "maxDecodedBytesPerResource"]),
					),
					planDigest: z.string(),
					itemsOmitted: z.number().int().nonnegative(),
					responseTruncated: z.boolean(),
					items: z.array(planItemSchema),
				}),
			),
			annotations: readOnly,
		},
		async (
			{ source, budgets, inline, itemLimit, maxResponseBytes, ...options },
			context,
		) => {
			try {
				await workspace.prepare({ createOutput: false });
				const coreBudgets = budgetsFromWire(budgets);
				const result = await automation.planExtraction(
					source,
					{
						selection: selectionFromWire(options.selection),
						conflictPolicy: options.conflictPolicy,
						...(options.outputRootId === undefined
							? {}
							: { outputRootId: options.outputRootId }),
						...(options.outputSubdirectory === undefined
							? {}
							: { outputSubdirectory: options.outputSubdirectory }),
						...(coreBudgets === undefined ? {} : { budgets: coreBudgets }),
					},
					toControl(context),
				);
				const candidates =
					inline === "all"
						? result.items.slice(0, itemLimit).map((item) => ({
								entryId: item.entryId,
								...(item.entryPath === undefined
									? {}
									: { entryPath: item.entryPath }),
								...(item.packedBytes === undefined
									? {}
									: { packedBytes: item.packedBytes.toString() }),
								...(item.outputBytes === undefined
									? {}
									: { outputBytes: item.outputBytes.toString() }),
								...(item.decodedBytes === undefined
									? {}
									: { decodedBytes: item.decodedBytes.toString() }),
								status: item.status,
								...(item.reason === undefined ? {} : { reason: item.reason }),
								...(item.error === undefined
									? {}
									: {
											error: {
												code: item.error.code,
												message: item.error.message.slice(0, 2048),
											},
										}),
							}))
						: [];
				return success(
					boundedPage(
						candidates,
						(visible) => ({
							source: result.source,
							formatId: result.formatId,
							outputRootId: result.outputRootId,
							outputDirectory: result.outputDirectory,
							selected: result.selected,
							ready: result.ready,
							skipped: result.skipped,
							failed: result.failed,
							inputBytes: result.inputBytes.toString(),
							outputBytes: result.outputBytes?.toString() ?? null,
							unknownOutputSizes: result.unknownOutputSizes,
							budgetViolations: result.budgetViolations.map((violation) => ({
								...violation,
								actual: violation.actual.toString(),
								limit: violation.limit.toString(),
							})),
							budgetUnknowns: result.budgetUnknowns,
							planDigest: result.planDigest,
							itemsOmitted: result.items.length - visible.length,
							responseTruncated: visible.length < result.items.length,
							items: visible,
						}),
						maxResponseBytes,
						true,
					),
				);
			} catch (error) {
				return failure(error);
			}
		},
	);

	const artifactSchema = z.object({
		outputRootId: z.string(),
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
				outputRootId: z.string().min(1).optional(),
				expectedPlanDigest: z.string().length(64).optional(),
				budgets: extractionBudgetsSchema.optional(),
				offset: z.number().int().nonnegative().default(0),
				selection: extractionSelectionSchema.default({ mode: "all" }),
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
					outputRootId: z.string(),
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
						options.outputRootId,
					);
					const stored = z
						.object({
							status: z.enum(["completed", "partial", "failed"]),
							outputRootId: z.string(),
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
				const selection = selectionFromWire(options.selection);
				const extractionBudgets = budgetsFromWire(options.budgets);
				const result = await automation.extractEntries(
					source,
					{
						selection,
						conflictPolicy: options.conflictPolicy,
						...(options.expectedPlanDigest === undefined
							? {}
							: { expectedPlanDigest: options.expectedPlanDigest }),
						...(extractionBudgets === undefined
							? {}
							: { budgets: extractionBudgets }),
						...(options.outputRootId === undefined
							? {}
							: { outputRootId: options.outputRootId }),
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
							outputRootId: result.outputRootId,
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
		outputRootId: z.string().optional(),
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
	const asyncJobStateSchema = z.enum([
		"queued",
		"running",
		"completed",
		"partial",
		"failed",
		"cancelled",
	]);
	const asyncJobHeaderSchema = z.object({
		jobId: z.string().uuid(),
		state: asyncJobStateSchema,
		createdAt: z.string(),
		startedAt: z.string().optional(),
		finishedAt: z.string().optional(),
		progress: z.number().int().nonnegative(),
		total: z.number().int().nonnegative().optional(),
		message: z.string().optional(),
	});
	const asyncExtractionStatusSchema = asyncJobHeaderSchema.extend({
		status: z.enum(["completed", "partial", "failed"]).optional(),
		hasFailures: z.boolean().optional(),
		outputRootId: z.string().optional(),
		outputDirectory: z.string().optional(),
		selected: z.number().int().nonnegative().optional(),
		extracted: z.number().int().nonnegative().optional(),
		skipped: z.number().int().nonnegative().optional(),
		failed: z.number().int().nonnegative().optional(),
		bytesWritten: z.string().optional(),
		report: artifactSchema.optional(),
		reportError: errorSchema.optional(),
		error: errorSchema.optional(),
		itemsOmitted: z.number().int().nonnegative().optional(),
		responseTruncated: z.boolean().optional(),
		offset: z.number().int().nonnegative().optional(),
		nextOffset: z.number().int().nonnegative().nullable().optional(),
		items: z.array(batchItemSchema).optional(),
	});
	server.registerTool(
		"start_extraction",
		{
			description:
				"Submit one extraction as a background job and return immediately. Poll get_extraction_status for progress and the saved report.",
			inputSchema: z.object({
				source: sourceSchema,
				outputRootId: z.string().min(1).optional(),
				expectedPlanDigest: z.string().length(64).optional(),
				budgets: extractionBudgetsSchema.optional(),
				selection: extractionSelectionSchema.default({ mode: "all" }),
				outputSubdirectory: z.string().min(1).optional(),
				conflictPolicy: z.enum(["fail", "skip", "overwrite"]).default("fail"),
			}),
			outputSchema: successOrFailure(asyncJobHeaderSchema),
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
			},
		},
		async (input) => {
			try {
				await workspace.prepare();
				const extractionBudgets = budgetsFromWire(input.budgets);
				const job = extractionJobs.start(
					async (control) => {
						const result = await automation.extractEntries(
							input.source,
							{
								selection: selectionFromWire(input.selection),
								conflictPolicy: input.conflictPolicy,
								...(input.expectedPlanDigest === undefined
									? {}
									: { expectedPlanDigest: input.expectedPlanDigest }),
								...(extractionBudgets === undefined
									? {}
									: { budgets: extractionBudgets }),
								...(input.outputRootId === undefined
									? {}
									: { outputRootId: input.outputRootId }),
								...(input.outputSubdirectory === undefined
									? {}
									: { outputSubdirectory: input.outputSubdirectory }),
							},
							control,
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
						return {
							result,
							...(report === undefined ? {} : { report }),
							...(reportError === undefined ? {} : { reportError }),
						};
					},
					{ stateFromResult: (payload) => payload.result.status },
				);
				return success({ ...job });
			} catch (error) {
				return failure(error);
			}
		},
	);

	server.registerTool(
		"get_extraction_status",
		{
			description:
				"Poll a background extraction job. Terminal states include counts, report metadata, and optionally paged item results.",
			inputSchema: z.object({
				jobId: z.string().uuid(),
				inline: z.enum(["summary", "errors", "all"]).default("errors"),
				itemLimit: z.number().int().min(0).max(100).default(10),
				maxResponseBytes: budgetSchema,
			}),
			outputSchema: successOrFailure(asyncExtractionStatusSchema),
			annotations: readOnly,
		},
		async ({ jobId, inline, itemLimit, maxResponseBytes }) => {
			try {
				const snapshot = extractionJobs.get(jobId);
				if (snapshot === undefined)
					throw new GarbroError(
						"INVALID_ARGUMENT",
						`Unknown extraction job: ${jobId}`,
					);
				const header = {
					jobId: snapshot.jobId,
					state: snapshot.state,
					createdAt: snapshot.createdAt,
					...(snapshot.startedAt === undefined
						? {}
						: { startedAt: snapshot.startedAt }),
					...(snapshot.finishedAt === undefined
						? {}
						: { finishedAt: snapshot.finishedAt }),
					progress: snapshot.progress,
					...(snapshot.total === undefined ? {} : { total: snapshot.total }),
					...(snapshot.message === undefined
						? {}
						: { message: snapshot.message }),
				};
				if (snapshot.result === undefined) {
					return success({
						...header,
						...(snapshot.error === undefined
							? {}
							: {
									error: {
										code: snapshot.error.code,
										message: snapshot.error.message.slice(0, 2048),
									},
								}),
					});
				}
				const { result, report, reportError } = snapshot.result;
				const candidates =
					inline === "summary"
						? []
						: result.items.filter(
								(item) => inline === "all" || item.status === "failed",
							);
				const visible = candidates.slice(0, itemLimit).map(batchItemToWire);
				return success(
					boundedPage(
						visible,
						(items) => ({
							...header,
							status: result.status,
							hasFailures: result.hasFailures,
							outputRootId: result.outputRootId,
							outputDirectory: result.outputDirectory,
							selected: result.selected,
							extracted: result.extracted,
							skipped: result.skipped,
							failed: result.failed,
							bytesWritten: result.bytesWritten.toString(),
							...(report === undefined ? {} : { report }),
							...(reportError === undefined ? {} : { reportError }),
							itemsOmitted: Math.max(0, candidates.length - items.length),
							responseTruncated: items.length < candidates.length,
							offset: 0,
							nextOffset:
								items.length < candidates.length ? items.length : null,
							items,
						}),
						maxResponseBytes,
						true,
					),
				);
			} catch (error) {
				return failure(error);
			}
		},
	);

	server.registerTool(
		"cancel_extraction",
		{
			description:
				"Request cancellation of a queued or running extraction job.",
			inputSchema: z.object({ jobId: z.string().uuid() }),
			outputSchema: successOrFailure(asyncJobHeaderSchema),
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
			},
		},
		async ({ jobId }) => {
			try {
				const snapshot = extractionJobs.cancel(jobId);
				if (snapshot === undefined)
					throw new GarbroError(
						"INVALID_ARGUMENT",
						`Unknown extraction job: ${jobId}`,
					);
				return success({ ...snapshot });
			} catch (error) {
				return failure(error);
			}
		},
	);

	server.registerTool(
		"extract_resources",
		{
			description:
				"Extract several resources in one bounded batch. Review each source result and hasFailures; every completed source gets its own hashed report.",
			inputSchema: z.object({
				sources: z.array(sourceSchema).min(1).max(32),
				outputRootId: z.string().min(1).optional(),
				budgets: extractionBudgetsSchema.optional(),
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
				outputRootId,
				budgets,
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
				const coreBudgets = budgetsFromWire(budgets);
				const baseControl = toControl(context);
				const timeoutSignal =
					coreBudgets?.timeoutMs === undefined
						? undefined
						: AbortSignal.timeout(coreBudgets.timeoutMs);
				const batchSignal =
					baseControl.signal === undefined
						? timeoutSignal
						: timeoutSignal === undefined
							? baseControl.signal
							: AbortSignal.any([baseControl.signal, timeoutSignal]);
				const batchControl = {
					...baseControl,
					...(batchSignal === undefined ? {} : { signal: batchSignal }),
				};
				const plans = await Promise.all(
					sources.map(async (source) => {
						try {
							return await automation.planExtraction(
								source,
								{
									conflictPolicy,
									...(outputRootId === undefined ? {} : { outputRootId }),
									...(coreBudgets === undefined
										? {}
										: { budgets: coreBudgets }),
								},
								batchControl,
							);
						} catch (error) {
							if (batchSignal?.aborted) throw error;
							return undefined;
						}
					}),
				);
				if (coreBudgets !== undefined) {
					const ready = plans.reduce(
						(total, plan) => total + (plan?.ready ?? 0),
						0,
					);
					const inputBytes = plans.reduce(
						(total, plan) => total + (plan?.inputBytes ?? 0n),
						0n,
					);
					const knownOutputBytes = plans.reduce(
						(total, plan) => total + (plan?.outputBytes ?? 0n),
						0n,
					);
					const unknownOutputSizes = plans.reduce(
						(total, plan) => total + (plan?.unknownOutputSizes ?? 0),
						0,
					);
					const violations: Array<Record<string, string>> = [];
					if (
						coreBudgets.maxResources !== undefined &&
						ready > coreBudgets.maxResources
					)
						violations.push({
							budget: "maxResources",
							actual: String(ready),
							limit: String(coreBudgets.maxResources),
						});
					if (
						coreBudgets.maxInputBytes !== undefined &&
						inputBytes > coreBudgets.maxInputBytes
					)
						violations.push({
							budget: "maxInputBytes",
							actual: inputBytes.toString(),
							limit: coreBudgets.maxInputBytes.toString(),
						});
					if (
						coreBudgets.maxOutputBytes !== undefined &&
						unknownOutputSizes === 0 &&
						knownOutputBytes > coreBudgets.maxOutputBytes
					)
						violations.push({
							budget: "maxOutputBytes",
							actual: knownOutputBytes.toString(),
							limit: coreBudgets.maxOutputBytes.toString(),
						});
					const planViolations = plans.flatMap((plan) =>
						(plan?.budgetViolations ?? [])
							.filter(
								(violation) =>
									violation.budget === "maxDecodedBytesPerResource",
							)
							.map((violation) => ({
								budget: violation.budget,
								actual: violation.actual.toString(),
								limit: violation.limit.toString(),
							})),
					);
					violations.push(...planViolations);
					const unknowns = [
						...(coreBudgets.maxOutputBytes !== undefined &&
						unknownOutputSizes > 0
							? ["maxOutputBytes"]
							: []),
						...plans.flatMap((plan) => plan?.budgetUnknowns ?? []),
					];
					if (violations.length > 0 || unknowns.length > 0)
						throw new GarbroError(
							"LIMIT_EXCEEDED",
							"Resource batch exceeds or cannot prove the requested total budgets",
							{ details: { violations, unknowns } },
						);
				}
				await workspace.prepare();
				const results: Array<Record<string, unknown>> = [];
				for (const [sourceIndex, source] of sources.entries()) {
					try {
						const plan = plans[sourceIndex];
						const result = await automation.extractEntries(
							source,
							{
								conflictPolicy,
								...(outputRootId === undefined ? {} : { outputRootId }),
								...(coreBudgets === undefined ? {} : { budgets: coreBudgets }),
								...(plan === undefined
									? {}
									: { expectedPlanDigest: plan.planDigest }),
							},
							batchControl,
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
							outputRootId: result.outputRootId,
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

	server.registerTool(
		"verify_artifacts",
		{
			description:
				"Hash and independently inspect extracted artifacts inside configured output roots. Optional expected hashes and sizes promote evidence to manifest verification.",
			inputSchema: z.object({
				artifacts: z
					.array(
						z.object({
							outputRootId: z.string().min(1).optional(),
							path: z.string().min(1),
							expected: z
								.object({
									sha256: z
										.string()
										.regex(/^[0-9a-f]{64}$/i)
										.optional(),
									bytes: z.string().regex(/^\d+$/).optional(),
								})
								.optional(),
						}),
					)
					.min(1)
					.max(100),
				maxResponseBytes: budgetSchema,
			}),
			outputSchema: successOrFailure(
				z.object({
					status: z.enum(["completed", "partial", "failed"]),
					hasFailures: z.boolean(),
					verified: z.number().int().nonnegative(),
					mismatched: z.number().int().nonnegative(),
					invalid: z.number().int().nonnegative(),
					inspected: z.number().int().nonnegative(),
					failed: z.number().int().nonnegative(),
					resultsOmitted: z.number().int().nonnegative(),
					responseTruncated: z.boolean(),
					results: z.array(
						z.union([
							z.object({
								status: z.enum([
									"inspected",
									"verified",
									"mismatch",
									"invalid",
								]),
								level: z.enum(["hash", "structural", "manifest"]),
								outputRootId: z.string(),
								relativePath: z.string(),
								absolutePath: z.string(),
								bytes: z.string(),
								sha256: z.string(),
								matched: z.boolean().nullable(),
								format: z.enum(["wav", "ogg", "binary"]),
								structuralValid: z.boolean().nullable(),
								metadata: z.record(
									z.string(),
									z.union([z.string(), z.number()]),
								),
								warnings: z.array(z.string()),
								nextAction: z.string().optional(),
							}),
							z.object({
								status: z.literal("failed"),
								outputRootId: z.string().optional(),
								relativePath: z.string(),
								error: errorSchema,
							}),
						]),
					),
				}),
			),
			annotations: readOnly,
		},
		async ({ artifacts, maxResponseBytes }, context) => {
			try {
				await workspace.prepare({ createOutput: false });
				const results: Array<Record<string, unknown>> = [];
				for (const [index, artifact] of artifacts.entries()) {
					try {
						const result = await verifyArtifact(
							workspace,
							{
								path: artifact.path,
								...(artifact.outputRootId === undefined
									? {}
									: { outputRootId: artifact.outputRootId }),
							},
							{
								...(artifact.expected?.sha256 === undefined
									? {}
									: { sha256: artifact.expected.sha256 }),
								...(artifact.expected?.bytes === undefined
									? {}
									: { bytes: BigInt(artifact.expected.bytes) }),
							},
							context.mcpReq.signal,
						);
						results.push({
							...result,
							bytes: result.bytes.toString(),
							...(result.status === "mismatch"
								? {
										nextAction: "Check the expected manifest or extract again.",
									}
								: result.status === "invalid"
									? {
											nextAction:
												"Treat the artifact as unusable and inspect the decoder.",
										}
									: {}),
						});
					} catch (error) {
						if (context.mcpReq.signal.aborted) throw error;
						const converted = asGarbroError(error);
						results.push({
							status: "failed",
							...(artifact.outputRootId === undefined
								? {}
								: { outputRootId: artifact.outputRootId }),
							relativePath: artifact.path,
							error: {
								code: converted.code,
								message: converted.message.slice(0, 2048),
								...(converted.details === undefined
									? {}
									: { details: converted.details }),
							},
						});
					}
					await toControl(context).onProgress?.({
						progress: index + 1,
						total: artifacts.length,
						message: artifact.path,
					});
				}
				const count = (status: string) =>
					results.filter((result) => result.status === status).length;
				const failed = count("failed");
				const invalid = count("invalid");
				const mismatched = count("mismatch");
				const hasFailures = failed + invalid + mismatched > 0;
				return success(
					boundedPage(
						results,
						(visible) => ({
							status: !hasFailures
								? "completed"
								: failed + invalid + mismatched === results.length
									? "failed"
									: "partial",
							hasFailures,
							verified: count("verified"),
							mismatched,
							invalid,
							inspected: count("inspected"),
							failed,
							resultsOmitted: results.length - visible.length,
							responseTruncated: visible.length < results.length,
							results: visible,
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
