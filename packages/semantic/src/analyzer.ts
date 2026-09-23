import type { InputReference, WorkspacePolicy } from "@garbro-mcp/core";
import type { SemanticName, SemanticRecord } from "./model.js";

export interface SemanticGoal {
	subjectType?: SemanticName;
	query?: string;
	predicate?: SemanticName;
	objectType?: SemanticName;
	resourceType?: string;
}

export interface SemanticAnalysisBudgets {
	maxInputBytes?: bigint;
	maxFacts?: number;
	timeoutMs?: number;
}

export interface SemanticAnalyzerDescriptor {
	id: string;
	version: string;
	engineIds: readonly string[];
	requires: {
		predicates?: readonly SemanticName[];
		formatIds?: readonly string[];
		resourceTypes?: readonly string[];
	};
	produces: {
		entityTypes: readonly SemanticName[];
		predicates: readonly SemanticName[];
		evidenceKinds: readonly SemanticName[];
	};
}

export interface SemanticAnalyzerPlan {
	analyzerId: string;
	analyzerVersion: string;
	inputBytes: bigint | null;
	estimatedFacts: number | null;
	configuration: Readonly<Record<string, unknown>>;
}

export interface SemanticPlanningContext {
	workspace: WorkspacePolicy;
	game: InputReference;
	engineId: string;
	profile?: string;
	budgets: SemanticAnalysisBudgets;
	signal: AbortSignal;
}

export interface SemanticAnalysisContext extends SemanticPlanningContext {
	readFacts(predicate: SemanticName): AsyncIterable<SemanticRecord>;
	reportProgress(progress: {
		completed: number;
		total?: number;
		message?: string;
	}): Promise<void>;
}

export interface SemanticAnalyzer {
	readonly descriptor: SemanticAnalyzerDescriptor;
	plan(
		context: SemanticPlanningContext,
		goal: SemanticGoal,
	): Promise<SemanticAnalyzerPlan>;
	analyze(
		context: SemanticAnalysisContext,
		plan: SemanticAnalyzerPlan,
	): AsyncIterable<SemanticRecord>;
}

export interface AnalyzerGraphPlan {
	engineId: string;
	goal: SemanticGoal;
	stages: readonly (readonly SemanticAnalyzerDescriptor[])[];
	analyzers: readonly SemanticAnalyzerDescriptor[];
	missingPredicates: readonly SemanticName[];
}

function supportsEngine(
	descriptor: SemanticAnalyzerDescriptor,
	engineId: string,
): boolean {
	return (
		descriptor.engineIds.includes("*") ||
		descriptor.engineIds.includes(engineId)
	);
}

function assertDescriptor(descriptor: SemanticAnalyzerDescriptor): void {
	if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(descriptor.id))
		throw new Error(`Invalid semantic analyzer ID: ${descriptor.id}`);
	if (descriptor.version.length === 0)
		throw new Error(`Invalid semantic analyzer version: ${descriptor.id}`);
	if (descriptor.engineIds.length === 0)
		throw new Error(`Semantic analyzer has no engine IDs: ${descriptor.id}`);
}

export class SemanticAnalyzerRegistry {
	readonly #analyzers = new Map<string, SemanticAnalyzer>();

	register(analyzer: SemanticAnalyzer): void {
		assertDescriptor(analyzer.descriptor);
		if (this.#analyzers.has(analyzer.descriptor.id))
			throw new Error(
				`Semantic analyzer already registered: ${analyzer.descriptor.id}`,
			);
		this.#analyzers.set(analyzer.descriptor.id, analyzer);
	}

	get(id: string): SemanticAnalyzer | undefined {
		return this.#analyzers.get(id);
	}

	list(engineId?: string): readonly SemanticAnalyzer[] {
		return [...this.#analyzers.values()]
			.filter(
				(analyzer) =>
					engineId === undefined ||
					supportsEngine(analyzer.descriptor, engineId),
			)
			.sort((left, right) =>
				left.descriptor.id.localeCompare(right.descriptor.id),
			);
	}

	planGraph(
		engineId: string,
		goal: SemanticGoal,
		availablePredicates: readonly SemanticName[] = [],
	): AnalyzerGraphPlan {
		const analyzers = this.list(engineId);
		const producers = new Map<SemanticName, SemanticAnalyzer[]>();
		for (const analyzer of analyzers)
			for (const predicate of analyzer.descriptor.produces.predicates) {
				const list = producers.get(predicate) ?? [];
				list.push(analyzer);
				producers.set(predicate, list);
			}

		const selected = new Map<string, SemanticAnalyzer>();
		const missing = new Set<SemanticName>();
		const visiting = new Set<string>();
		const visited = new Set<string>();
		const ordered: SemanticAnalyzer[] = [];
		const available = new Set(availablePredicates);

		const visit = (analyzer: SemanticAnalyzer): void => {
			if (visited.has(analyzer.descriptor.id)) return;
			if (visiting.has(analyzer.descriptor.id))
				throw new Error(
					`Semantic analyzer dependency cycle includes ${analyzer.descriptor.id}`,
				);
			visiting.add(analyzer.descriptor.id);
			selected.set(analyzer.descriptor.id, analyzer);
			for (const predicate of analyzer.descriptor.requires.predicates ?? []) {
				if (available.has(predicate)) continue;
				const dependencies = producers.get(predicate) ?? [];
				if (dependencies.length === 0) {
					missing.add(predicate);
					continue;
				}
				for (const dependency of dependencies) visit(dependency);
			}
			visiting.delete(analyzer.descriptor.id);
			visited.add(analyzer.descriptor.id);
			ordered.push(analyzer);
		};

		if (goal.predicate !== undefined) {
			const roots = producers.get(goal.predicate) ?? [];
			if (roots.length === 0 && !available.has(goal.predicate))
				missing.add(goal.predicate);
			for (const root of roots) visit(root);
		} else {
			for (const analyzer of analyzers) visit(analyzer);
		}

		const depth = new Map<string, number>();
		for (const analyzer of ordered) {
			let value = 0;
			for (const predicate of analyzer.descriptor.requires.predicates ?? [])
				for (const producer of producers.get(predicate) ?? [])
					if (selected.has(producer.descriptor.id))
						value = Math.max(
							value,
							(depth.get(producer.descriptor.id) ?? 0) + 1,
						);
			depth.set(analyzer.descriptor.id, value);
		}
		const stageMap = new Map<number, SemanticAnalyzerDescriptor[]>();
		for (const analyzer of ordered) {
			const value = depth.get(analyzer.descriptor.id) ?? 0;
			const stage = stageMap.get(value) ?? [];
			stage.push(analyzer.descriptor);
			stageMap.set(value, stage);
		}
		const stages = [...stageMap.entries()]
			.sort(([left], [right]) => left - right)
			.map(([, stage]) =>
				stage.sort((left, right) => left.id.localeCompare(right.id)),
			);

		return {
			engineId,
			goal,
			stages,
			analyzers: ordered.map((analyzer) => analyzer.descriptor),
			missingPredicates: [...missing].sort(),
		};
	}
}
