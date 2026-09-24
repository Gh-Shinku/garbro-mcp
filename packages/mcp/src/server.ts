import { basename, dirname, isAbsolute, resolve } from "node:path";
import {
	type ArchiveAutomationOptions,
	ArchiveAutomationService,
	AsyncJobManager,
	type AsyncJobSnapshot,
	type AutomationControl,
	asGarbroError,
	DEFAULT_AUTOMATION_LIMITS,
	type ExtractionBudgets,
	type ExtractionPlan,
	type ExtractionSelection,
	entryResourceTypes,
	entryToWire,
	type FormatRegistry,
	GarbroError,
	TemporaryWorkspaceManager,
	verifyExtractionResult,
	WorkspacePolicy,
	writeExtractionReport,
} from "@garbro-mcp/core";
import {
	createDefaultRegistry,
	formatSupportCatalog,
} from "@garbro-mcp/formats";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { BUILD_IDENTITY } from "./build.js";
import { toolResult } from "./context.js";

export const SERVER_VERSION = BUILD_IDENTITY.version;
export const SERVER_PURPOSE =
	"Run bounded asynchronous jobs that detect, inspect, extract, and verify supported game resources.";
export const SERVER_SCOPE = [
	"known archive and resource formats",
	"bounded asynchronous discovery and inspection",
	"safe planned extraction",
	"mandatory post-extraction verification",
] as const;
export const SERVER_NON_CAPABILITIES = [
	"game logic reverse engineering",
	"automatic adaptation to unknown engines",
	"character, dialogue, voice, or sprite inference",
	"executable decompilation",
	"automatic semantic mapping",
] as const;
export const SERVER_INSTRUCTIONS = `${SERVER_PURPOSE}

Use submit_task for scan, inspect, and extract work. Paths are absolute local paths supplied from the user's current request; no readable roots are configured at server startup. Every call returns immediately with a taskId. Poll get_task until it reaches completed, partial, failed, or cancelled. Use cancel_task to request cooperative cancellation.

Extraction always writes to an isolated expiring task directory below the server's temporary directory, performs an internal preflight, and independently reopens every written artifact for size, SHA-256, and supported structural validation before it can complete. Do not submit a separate verification step. The agent, not this server, decides whether and where verified artifacts are delivered to the user.

Do not delegate game-logic reverse engineering, executable decompilation, unknown-engine adaptation, or character/dialogue/voice/sprite inference to this server. If a request needs a semantic relationship, report that the resource bytes may be extractable but the relationship requires external analysis or user input. Never infer semantic ownership from filenames alone.`;

const resourceTypes = ["archive", "image", "audio", "script"] as const;
const terminalStates = ["completed", "partial", "failed", "cancelled"] as const;
const absolutePathSchema = z
	.string()
	.min(1)
	.refine(isAbsolute, "Expected an absolute local path for this system");
const sourceSchema = z.object({
	path: absolutePathSchema,
});
const decimalBytesSchema = z.string().regex(/^[1-9]\d*$/);
const extractionSelectionSchema = z.discriminatedUnion("mode", [
	z.object({
		mode: z.literal("all"),
		excludeGlobs: z.array(z.string()).max(32).optional(),
		resourceTypes: z.array(z.enum(entryResourceTypes)).min(1).optional(),
	}),
	z.object({
		mode: z.literal("ids"),
		entryIds: z.array(z.string().min(1)).min(1).max(10_000),
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
	maxResources: z.number().int().positive().max(100_000).optional(),
	maxInputBytes: decimalBytesSchema.optional(),
	maxOutputBytes: decimalBytesSchema.optional(),
	maxDecodedBytesPerResource: decimalBytesSchema.optional(),
	timeoutMs: z.number().int().positive().max(3_600_000).optional(),
});
const scanTaskSchema = z.object({
	type: z.literal("scan"),
	path: absolutePathSchema,
	recursive: z.boolean().default(true),
	includeGlobs: z.array(z.string()).max(32).optional(),
	excludeGlobs: z.array(z.string()).max(32).optional(),
	maxDepth: z.number().int().min(0).max(64).default(8),
	cursor: z.string().min(1).optional(),
	limit: z.number().int().positive().max(200).default(50),
	includeUnrecognized: z.boolean().default(false),
	resourceTypes: z.array(z.enum(resourceTypes)).max(4).optional(),
	formatIds: z.array(z.string().min(1)).max(128).optional(),
});
const inspectTaskSchema = z.object({
	type: z.literal("inspect"),
	source: sourceSchema,
	includeEntries: z.boolean().default(true),
	includeMetadata: z.boolean().default(false),
	includeGlobs: z.array(z.string()).max(32).optional(),
	excludeGlobs: z.array(z.string()).max(32).optional(),
	caseSensitive: z.boolean().default(false),
	compressed: z.boolean().optional(),
	encrypted: z.boolean().optional(),
	resourceTypes: z.array(z.enum(entryResourceTypes)).min(1).optional(),
	offset: z.number().int().nonnegative().default(0),
	limit: z.number().int().positive().max(200).default(50),
});
const extractSourceSchema = z.object({
	source: sourceSchema,
	selection: extractionSelectionSchema.default({ mode: "all" }),
});
const extractTaskSchema = z.object({
	type: z.literal("extract"),
	sources: z.array(extractSourceSchema).min(1).max(32),
	budgets: extractionBudgetsSchema.optional(),
});
const taskSchema = z.discriminatedUnion("type", [
	scanTaskSchema,
	inspectTaskSchema,
	extractTaskSchema,
]);

type TaskInput = z.infer<typeof taskSchema>;
type TaskKind = TaskInput["type"];
type TaskStatus = "completed" | "partial" | "failed";
type TaskPayload = {
	type: TaskKind;
	status: TaskStatus;
	result: Record<string, unknown>;
};

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

export interface BuildServerOptions extends ArchiveAutomationOptions {
	registry?: FormatRegistry;
	tempDirectory?: string;
	retentionMs?: number;
}

function success(payload: Record<string, unknown>) {
	return toolResult({ ...payload, outcome: { status: "ok", warnings: [] } });
}

function failure(error: unknown) {
	const converted = asGarbroError(error);
	const payload = {
		outcome: {
			status: "failed" as const,
			warnings: [] as string[],
			nextAction: {
				code: "inspect_error",
				message: "Inspect the structured error and retry safely.",
			},
		},
		error: {
			code: converted.code,
			message: converted.message.slice(0, 2048),
			...(converted.details === undefined
				? {}
				: { details: converted.details }),
		},
	};
	return { ...toolResult(payload), isError: true };
}

function budgetsFromWire(
	budgets: z.infer<typeof extractionBudgetsSchema> | undefined,
): ExtractionBudgets | undefined {
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

function phaseControl(
	control: AutomationControl,
	phase: string,
): AutomationControl {
	return {
		...control,
		onProgress: async (progress) => {
			await control.onProgress?.({ ...progress, phase });
		},
	};
}

function operationControl(
	control: AutomationControl,
	timeoutMs: number | undefined,
): AutomationControl {
	const timeoutSignal =
		timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);
	const signal =
		control.signal === undefined
			? timeoutSignal
			: timeoutSignal === undefined
				? control.signal
				: AbortSignal.any([control.signal, timeoutSignal]);
	return { ...control, ...(signal === undefined ? {} : { signal }) };
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
	if (signal?.aborted)
		throw new GarbroError("CANCELLED", "Task was cancelled", {
			cause: signal.reason,
		});
}

function assertAggregateBudgets(
	plans: readonly ExtractionPlan[],
	budgets: ExtractionBudgets | undefined,
): void {
	if (budgets === undefined) return;
	const ready = plans.reduce((total, plan) => total + plan.ready, 0);
	const inputBytes = plans.reduce((total, plan) => total + plan.inputBytes, 0n);
	const outputBytes = plans.reduce(
		(total, plan) => total + (plan.outputBytes ?? 0n),
		0n,
	);
	const unknownOutputSizes = plans.reduce(
		(total, plan) => total + plan.unknownOutputSizes,
		0,
	);
	const violations: Array<{ budget: string; actual: string; limit: string }> =
		[];
	if (budgets.maxResources !== undefined && ready > budgets.maxResources)
		violations.push({
			budget: "maxResources",
			actual: String(ready),
			limit: String(budgets.maxResources),
		});
	if (budgets.maxInputBytes !== undefined && inputBytes > budgets.maxInputBytes)
		violations.push({
			budget: "maxInputBytes",
			actual: inputBytes.toString(),
			limit: budgets.maxInputBytes.toString(),
		});
	if (
		budgets.maxOutputBytes !== undefined &&
		unknownOutputSizes === 0 &&
		outputBytes > budgets.maxOutputBytes
	)
		violations.push({
			budget: "maxOutputBytes",
			actual: outputBytes.toString(),
			limit: budgets.maxOutputBytes.toString(),
		});
	violations.push(
		...plans.flatMap((plan) =>
			plan.budgetViolations.map((violation) => ({
				budget: violation.budget,
				actual: violation.actual.toString(),
				limit: violation.limit.toString(),
			})),
		),
	);
	const unknowns = [
		...(budgets.maxOutputBytes !== undefined && unknownOutputSizes > 0
			? ["maxOutputBytes"]
			: []),
		...plans.flatMap((plan) => plan.budgetUnknowns),
	];
	if (violations.length > 0 || unknowns.length > 0)
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			"Extraction task exceeds or cannot prove the requested aggregate budgets",
			{ details: { violations, unknowns } },
		);
}

function serializeError(error: unknown) {
	const converted = asGarbroError(error);
	return {
		code: converted.code,
		message: converted.message.slice(0, 2048),
		...(converted.details === undefined ? {} : { details: converted.details }),
	};
}

function taskHeader(snapshot: AsyncJobSnapshot<TaskPayload>) {
	return {
		taskId: snapshot.jobId,
		type: snapshot.kind,
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
		...(snapshot.phase === undefined ? {} : { phase: snapshot.phase }),
		...(snapshot.message === undefined ? {} : { message: snapshot.message }),
	};
}

export function buildServer(options: BuildServerOptions = {}): McpServer {
	const registry =
		options.registry ??
		createDefaultRegistry({
			maxDecodedBytes:
				options.limits?.decodedResourceMaxBytes ??
				DEFAULT_AUTOMATION_LIMITS.decodedResourceMaxBytes,
		});
	const temporary = new TemporaryWorkspaceManager({
		...(options.tempDirectory === undefined
			? {}
			: { tempDirectory: options.tempDirectory }),
		...(options.retentionMs === undefined
			? {}
			: { retentionMs: options.retentionMs }),
	});
	const automationOptions = {
		...(options.limits === undefined ? {} : { limits: options.limits }),
	};
	const fileContext = (path: string, outputRoot = temporary.tempDirectory) => {
		const absolutePath = resolve(path);
		const workspace = new WorkspacePolicy({
			inputRoots: { source: dirname(absolutePath) },
			outputRoot,
		});
		return {
			workspace,
			automation: new ArchiveAutomationService(
				registry,
				workspace,
				automationOptions,
			),
			reference: { rootId: "source", path: basename(absolutePath) },
			absolutePath,
		};
	};
	const directoryContext = (path: string) => {
		const absolutePath = resolve(path);
		const workspace = new WorkspacePolicy({
			inputRoots: { source: absolutePath },
			outputRoot: temporary.tempDirectory,
		});
		return {
			workspace,
			automation: new ArchiveAutomationService(
				registry,
				workspace,
				automationOptions,
			),
			absolutePath,
		};
	};
	const jobs = new AsyncJobManager<TaskPayload>();
	const idempotency = new Map<string, string>();
	const supportById = new Map<string, SupportRecord>(
		(formatSupportCatalog.implementations as readonly SupportRecord[]).map(
			(support) => [support.localId, support],
		),
	);
	const server = new McpServer(
		{ name: "garbro-mcp", version: SERVER_VERSION },
		{ instructions: SERVER_INSTRUCTIONS },
	);

	const serverInfo = async () => {
		await temporary.prepare();
		return {
			purpose: SERVER_PURPOSE,
			scope: [...SERVER_SCOPE],
			notSupported: [...SERVER_NON_CAPABILITIES],
			server: { name: "garbro-mcp", ...BUILD_IDENTITY, transport: "stdio" },
			temporaryWorkspace: {
				path: temporary.tempDirectory,
				retentionMs: temporary.retentionMs,
			},
			limits: {
				...DEFAULT_AUTOMATION_LIMITS,
				...(options.limits ?? {}),
			},
			capabilities: {
				taskTypes: ["scan", "inspect", "extract"],
				resourceTypes,
				entryResourceTypes: [...entryResourceTypes],
				mandatoryExtractionVerification: true,
				dynamicAbsolutePaths: true,
				temporaryExtraction: true,
			},
		};
	};

	server.registerResource(
		"server-info",
		"garbro://server/info",
		{
			title: "garbro-mcp server information",
			description:
				"Temporary workspace, limits, scope, capabilities, and build identity.",
			mimeType: "application/json",
		},
		async (uri) => ({
			contents: [
				{
					uri: uri.href,
					mimeType: "application/json",
					text: JSON.stringify(await serverInfo(), null, 2),
				},
			],
		}),
	);

	server.registerResource(
		"format-catalog",
		"garbro://formats",
		{
			title: "garbro-mcp format catalog",
			description:
				"Implemented formats, support status, and known limitations.",
			mimeType: "application/json",
		},
		async (uri) => ({
			contents: [
				{
					uri: uri.href,
					mimeType: "application/json",
					text: JSON.stringify(
						registry.listFormats().map((format) => ({
							id: format.id,
							name: format.name,
							extensions: [...format.extensions],
							capabilities: format.capabilities,
							attribution: format.attribution,
							support: supportById.get(format.id),
						})),
						null,
						2,
					),
				},
			],
		}),
	);

	const runScan = async (
		input: z.infer<typeof scanTaskSchema>,
		control: AutomationControl,
	): Promise<TaskPayload> => {
		const context = directoryContext(input.path);
		const { automation, workspace } = context;
		await workspace.prepare({ createOutput: false });
		const result = await automation.scanArchives(
			"source",
			{
				path: ".",
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
			},
			phaseControl(control, "scanning"),
		);
		const resourceFilter = new Set(input.resourceTypes ?? []);
		const formatFilter = new Set(input.formatIds ?? []);
		const archives = result.archives
			.filter((item) => {
				const support = supportById.get(item.format.id);
				return (
					(formatFilter.size === 0 || formatFilter.has(item.format.id)) &&
					(resourceFilter.size === 0 ||
						(support !== undefined &&
							resourceFilter.has(support.reference.type)))
				);
			})
			.map((item) => ({
				source: { path: resolve(context.absolutePath, item.source.path) },
				size: item.size.toString(),
				formatId: item.format.id,
				resourceType: supportById.get(item.format.id)?.reference.type,
				validation: item.validation,
				confidence: item.confidence,
				warnings: [...item.warnings],
			}));
		return {
			type: "scan",
			status: result.failures.length > 0 ? "partial" : "completed",
			result: {
				scanned: result.scanned,
				archives,
				unrecognized: input.includeUnrecognized
					? result.unrecognized.map((item) => ({
							source: {
								path: resolve(context.absolutePath, item.source.path),
							},
							diagnosis: item.diagnosis,
						}))
					: [],
				unrecognizedCount: result.unrecognizedCount,
				failures: result.failures.map((item) => ({
					source: {
						path: resolve(context.absolutePath, item.source.path),
					},
					error: serializeError(item.error),
				})),
				nextCursor: result.nextCursor,
				complete: result.complete,
			},
		};
	};

	const runInspect = async (
		input: z.infer<typeof inspectTaskSchema>,
		control: AutomationControl,
	): Promise<TaskPayload> => {
		const context = fileContext(input.source.path);
		const { automation, workspace } = context;
		await workspace.prepare({ createOutput: false });
		await control.onProgress?.({ progress: 0, total: 1, phase: "inspecting" });
		const inspection = await automation.inspectArchive(context.reference);
		if (!inspection.recognized)
			return {
				type: "inspect",
				status: "failed",
				result: {
					recognized: false,
					source: { path: context.absolutePath },
					diagnosis: inspection.diagnosis,
				},
			};
		const entries = input.includeEntries
			? await automation.listEntries(context.reference, {
					caseSensitive: input.caseSensitive,
					offset: input.offset,
					limit: input.limit,
					...(input.includeGlobs === undefined
						? {}
						: { includeGlobs: input.includeGlobs }),
					...(input.excludeGlobs === undefined
						? {}
						: { excludeGlobs: input.excludeGlobs }),
					...(input.compressed === undefined
						? {}
						: { compressed: input.compressed }),
					...(input.encrypted === undefined
						? {}
						: { encrypted: input.encrypted }),
					...(input.resourceTypes === undefined
						? {}
						: { resourceTypes: input.resourceTypes }),
				})
			: undefined;
		await control.onProgress?.({ progress: 1, total: 1, phase: "inspecting" });
		return {
			type: "inspect",
			status: "completed",
			result: {
				recognized: true,
				source: { path: context.absolutePath },
				size: inspection.size.toString(),
				format: {
					id: inspection.format.id,
					name: inspection.format.name,
					extensions: [...inspection.format.extensions],
					resourceType: supportById.get(inspection.format.id)?.reference.type,
				},
				validation: inspection.validation,
				confidence: inspection.confidence,
				warnings: [...inspection.warnings],
				...(input.includeMetadata ? { metadata: inspection.metadata } : {}),
				summary: inspection.summary,
				...(entries === undefined
					? {}
					: {
							entries: {
								...entries,
								entries: entries.entries.map(entryToWire),
							},
						}),
			},
		};
	};

	const runExtract = async (
		input: z.infer<typeof extractTaskSchema>,
		baseControl: AutomationControl,
		taskId: string,
	): Promise<TaskPayload> => {
		const temporaryTask = await temporary.allocate(taskId);
		const budgets = budgetsFromWire(input.budgets);
		const control = operationControl(baseControl, budgets?.timeoutMs);
		const planBudgets =
			budgets?.maxDecodedBytesPerResource === undefined
				? undefined
				: { maxDecodedBytesPerResource: budgets.maxDecodedBytesPerResource };
		const contexts = input.sources.map((item, index) => ({
			item,
			...fileContext(item.source.path, temporaryTask.path),
			outputSubdirectory: `artifacts/${String(index + 1).padStart(4, "0")}`,
		}));
		const planned: Array<{
			context: (typeof contexts)[number];
			plan: ExtractionPlan;
		}> = [];
		for (const [index, context] of contexts.entries()) {
			throwIfCancelled(control.signal);
			await context.workspace.prepare();
			await control.onProgress?.({
				progress: index,
				total: contexts.length,
				phase: "planning",
				message: context.absolutePath,
			});
			planned.push({
				context,
				plan: await context.automation.planExtraction(
					context.reference,
					{
						selection: selectionFromWire(context.item.selection),
						conflictPolicy: "fail",
						outputSubdirectory: context.outputSubdirectory,
						...(planBudgets === undefined ? {} : { budgets: planBudgets }),
					},
					phaseControl(control, "planning"),
				),
			});
		}
		assertAggregateBudgets(
			planned.map((item) => item.plan),
			budgets,
		);

		const sources: Array<Record<string, unknown>> = [];
		for (const [index, item] of planned.entries()) {
			throwIfCancelled(control.signal);
			try {
				const { context, plan } = item;
				await control.onProgress?.({
					progress: index,
					total: planned.length,
					phase: "extracting",
					message: context.absolutePath,
				});
				const extracted = await context.automation.extractEntries(
					context.reference,
					{
						selection: selectionFromWire(context.item.selection),
						conflictPolicy: "fail",
						expectedPlanDigest: plan.planDigest,
						outputSubdirectory: context.outputSubdirectory,
						...(planBudgets === undefined ? {} : { budgets: planBudgets }),
					},
					phaseControl(control, "extracting"),
				);
				const verified = await verifyExtractionResult(
					context.workspace,
					extracted,
					phaseControl(control, "verifying"),
				);
				const report = await writeExtractionReport(context.workspace, verified);
				sources.push({
					source: { path: context.absolutePath },
					status: verified.status,
					hasFailures: verified.hasFailures,
					artifactDirectory: verified.outputDirectory,
					selected: verified.selected,
					extracted: verified.extracted,
					skipped: verified.skipped,
					failed: verified.failed,
					bytesWritten: verified.bytesWritten.toString(),
					verification: {
						verified: verified.verification.verified,
						mismatched: verified.verification.mismatched,
						invalid: verified.verification.invalid,
						inspected: verified.verification.inspected,
						failed: verified.verification.failed,
					},
					report: {
						relativePath: report.relativePath,
						absolutePath: report.absolutePath,
						bytesWritten: report.bytesWritten.toString(),
						sha256: report.sha256,
					},
				});
			} catch (error) {
				throwIfCancelled(control.signal);
				sources.push({
					source: { path: item.context.absolutePath },
					status: "failed",
					hasFailures: true,
					selected: 0,
					extracted: 0,
					skipped: 0,
					failed: 1,
					bytesWritten: "0",
					error: serializeError(error),
				});
			}
		}
		const extracted = sources.reduce(
			(total, source) => total + Number(source.extracted),
			0,
		);
		const skipped = sources.reduce(
			(total, source) => total + Number(source.skipped),
			0,
		);
		const failed = sources.reduce(
			(total, source) => total + Number(source.failed),
			0,
		);
		const hasFailures = sources.some((source) => source.hasFailures === true);
		const status: TaskStatus = !hasFailures
			? "completed"
			: extracted > 0 || skipped > 0
				? "partial"
				: "failed";
		return {
			type: "extract",
			status,
			result: {
				status,
				hasFailures,
				temporary: true,
				artifactDirectory: resolve(temporaryTask.path, "artifacts"),
				expiresAt: temporaryTask.expiresAt,
				totalSources: sources.length,
				extracted,
				skipped,
				failed,
				sources,
			},
		};
	};

	const runTask = (
		task: TaskInput,
		control: AutomationControl,
		taskId: string,
	): Promise<TaskPayload> => {
		switch (task.type) {
			case "scan":
				return runScan(task, control);
			case "inspect":
				return runInspect(task, control);
			case "extract":
				return runExtract(task, control, taskId);
		}
	};

	server.registerTool(
		"submit_task",
		{
			description:
				"Submit a bounded scan, inspect, or extract task and return immediately. Extract tasks always preflight and verify written artifacts.",
			inputSchema: z.object({
				task: taskSchema,
				idempotencyKey: z.string().min(1).max(128).optional(),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
			},
		},
		async ({ task, idempotencyKey }) => {
			try {
				if (idempotencyKey !== undefined) {
					const existingId = idempotency.get(idempotencyKey);
					const existing =
						existingId === undefined ? undefined : jobs.get(existingId);
					if (existing !== undefined) return success(taskHeader(existing));
				}
				const snapshot = jobs.start(
					(control, jobId) => runTask(task, control, jobId),
					{
						kind: task.type,
						stateFromResult: (payload) => payload.status,
					},
				);
				if (idempotencyKey !== undefined)
					idempotency.set(idempotencyKey, snapshot.jobId);
				return success(taskHeader(snapshot));
			} catch (error) {
				return failure(error);
			}
		},
	);

	server.registerTool(
		"get_task",
		{
			description:
				"Return progress and the terminal result for a submitted task.",
			inputSchema: z.object({ taskId: z.string().uuid() }),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
			},
		},
		async ({ taskId }) => {
			try {
				const snapshot = jobs.get(taskId);
				if (snapshot === undefined)
					throw new GarbroError("INVALID_ARGUMENT", `Unknown task: ${taskId}`);
				return success({
					...taskHeader(snapshot),
					...(snapshot.result === undefined
						? {}
						: { result: snapshot.result.result }),
					...(snapshot.error === undefined
						? {}
						: { error: serializeError(snapshot.error) }),
				});
			} catch (error) {
				return failure(error);
			}
		},
	);

	server.registerTool(
		"cancel_task",
		{
			description:
				"Request cooperative cancellation. Files already written are retained and reported when possible.",
			inputSchema: z.object({ taskId: z.string().uuid() }),
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
			},
		},
		async ({ taskId }) => {
			try {
				const snapshot = jobs.cancel(taskId);
				if (snapshot === undefined)
					throw new GarbroError("INVALID_ARGUMENT", `Unknown task: ${taskId}`);
				return success(taskHeader(snapshot));
			} catch (error) {
				return failure(error);
			}
		},
	);

	return server;
}

export { terminalStates };
