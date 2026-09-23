import type { InputReference, WorkspacePolicy } from "@garbro-mcp/core";
import type { SemanticName } from "./model.js";

export type EngineProbeStatus = "matched" | "candidate" | "unsupported";
export type EngineProbeConfidence = "high" | "medium" | "low";

export interface EngineProbeEvidence {
	source: InputReference;
	kind: "signature" | "filename" | "structure" | "static-executable";
	description: string;
}

export interface EngineCapability {
	predicate: SemanticName;
	available: boolean;
	reason?: string;
}

export interface EngineProbeResult {
	engineId: string;
	adapterVersion: string;
	status: EngineProbeStatus;
	confidence: EngineProbeConfidence;
	profile?: string;
	evidence: readonly EngineProbeEvidence[];
	requiredInputs: readonly {
		pattern: string;
		purpose: string;
		required: boolean;
	}[];
	capabilities: readonly EngineCapability[];
	warnings: readonly string[];
}

export interface EngineProbeContext {
	workspace: WorkspacePolicy;
	game: InputReference;
	allowExecutableInspection: boolean;
	maxInputBytes: bigint;
	signal: AbortSignal;
}

export interface EngineAdapterDescriptor {
	id: string;
	version: string;
	displayName: string;
	supportedProfiles: readonly string[];
	analyzerIds: readonly string[];
}

export interface EngineAdapter {
	readonly descriptor: EngineAdapterDescriptor;
	probe(context: EngineProbeContext): Promise<EngineProbeResult>;
}

function assertDescriptor(descriptor: EngineAdapterDescriptor): void {
	if (!/^[a-z][a-z0-9-]*$/.test(descriptor.id))
		throw new Error(`Invalid engine adapter ID: ${descriptor.id}`);
	if (descriptor.version.length === 0)
		throw new Error(`Invalid engine adapter version: ${descriptor.id}`);
}

export class EngineAdapterRegistry {
	readonly #adapters = new Map<string, EngineAdapter>();

	register(adapter: EngineAdapter): void {
		assertDescriptor(adapter.descriptor);
		if (this.#adapters.has(adapter.descriptor.id))
			throw new Error(
				`Engine adapter already registered: ${adapter.descriptor.id}`,
			);
		this.#adapters.set(adapter.descriptor.id, adapter);
	}

	get(id: string): EngineAdapter | undefined {
		return this.#adapters.get(id);
	}

	list(): readonly EngineAdapter[] {
		return [...this.#adapters.values()].sort((left, right) =>
			left.descriptor.id.localeCompare(right.descriptor.id),
		);
	}

	async probe(context: EngineProbeContext): Promise<EngineProbeResult[]> {
		const results = await Promise.all(
			this.list().map((adapter) => adapter.probe(context)),
		);
		const statusRank: Record<EngineProbeStatus, number> = {
			matched: 0,
			candidate: 1,
			unsupported: 2,
		};
		const confidenceRank: Record<EngineProbeConfidence, number> = {
			high: 0,
			medium: 1,
			low: 2,
		};
		return results.sort(
			(left, right) =>
				statusRank[left.status] - statusRank[right.status] ||
				confidenceRank[left.confidence] - confidenceRank[right.confidence] ||
				left.engineId.localeCompare(right.engineId),
		);
	}
}
