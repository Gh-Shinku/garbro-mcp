import { GarbroError } from "./errors.js";
import type { InputReference } from "./workspace.js";

export interface ResourceAlias {
	aliases: readonly string[];
	locale?: string;
	locator: {
		source: InputReference;
		entryId?: string;
	};
	metadata?: {
		title?: string;
		durationSeconds?: number;
		codec?: string;
		channels?: number;
	};
	expected?: {
		sha256?: string;
		decodedSha256?: string;
	};
}

export interface ResourceCatalogDocument {
	schemaVersion: 1;
	resources: ResourceAlias[];
}

export interface ResourceSearchMatch {
	resource: ResourceAlias;
	matchedBy: "alias" | "title" | "path";
	matchedValue: string;
	exact: boolean;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new GarbroError("INVALID_ARGUMENT", `${name} must be an object`);
	return value as Record<string, unknown>;
}

function optionalString(value: unknown, name: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.length === 0)
		throw new GarbroError(
			"INVALID_ARGUMENT",
			`${name} must be a non-empty string`,
		);
	return value;
}

export function parseResourceCatalog(value: unknown): ResourceCatalogDocument {
	const document = record(value, "Resource catalog");
	if (document.schemaVersion !== 1)
		throw new GarbroError(
			"INVALID_ARGUMENT",
			"Resource catalog schemaVersion must be 1",
		);
	if (!Array.isArray(document.resources))
		throw new GarbroError(
			"INVALID_ARGUMENT",
			"Resource catalog resources must be an array",
		);
	const resources = document.resources.map((value, index): ResourceAlias => {
		const item = record(value, `resources[${index}]`);
		if (
			!Array.isArray(item.aliases) ||
			item.aliases.length === 0 ||
			item.aliases.some(
				(alias) => typeof alias !== "string" || alias.length === 0,
			)
		)
			throw new GarbroError(
				"INVALID_ARGUMENT",
				`resources[${index}].aliases must contain non-empty strings`,
			);
		const locator = record(item.locator, `resources[${index}].locator`);
		const source = record(locator.source, `resources[${index}].locator.source`);
		const rootId = optionalString(
			source.rootId,
			`resources[${index}].locator.source.rootId`,
		);
		const path = optionalString(
			source.path,
			`resources[${index}].locator.source.path`,
		);
		if (rootId === undefined || path === undefined)
			throw new GarbroError(
				"INVALID_ARGUMENT",
				`resources[${index}].locator.source is incomplete`,
			);
		const metadata =
			item.metadata === undefined
				? undefined
				: record(item.metadata, `resources[${index}].metadata`);
		const durationSeconds = metadata?.durationSeconds;
		if (
			durationSeconds !== undefined &&
			(typeof durationSeconds !== "number" ||
				!Number.isFinite(durationSeconds) ||
				durationSeconds < 0)
		)
			throw new GarbroError(
				"INVALID_ARGUMENT",
				`resources[${index}].metadata.durationSeconds is invalid`,
			);
		const channels = metadata?.channels;
		if (
			channels !== undefined &&
			(!Number.isSafeInteger(channels) || Number(channels) <= 0)
		)
			throw new GarbroError(
				"INVALID_ARGUMENT",
				`resources[${index}].metadata.channels is invalid`,
			);
		const expected =
			item.expected === undefined
				? undefined
				: record(item.expected, `resources[${index}].expected`);
		for (const key of ["sha256", "decodedSha256"] as const) {
			const hash = expected?.[key];
			if (
				hash !== undefined &&
				(typeof hash !== "string" || !/^[0-9a-f]{64}$/i.test(hash))
			)
				throw new GarbroError(
					"INVALID_ARGUMENT",
					`resources[${index}].expected.${key} is invalid`,
				);
		}
		return {
			aliases: [...(item.aliases as string[])],
			...(optionalString(item.locale, `resources[${index}].locale`) ===
			undefined
				? {}
				: { locale: item.locale as string }),
			locator: {
				source: { rootId, path },
				...(optionalString(
					locator.entryId,
					`resources[${index}].locator.entryId`,
				) === undefined
					? {}
					: { entryId: locator.entryId as string }),
			},
			...(metadata === undefined
				? {}
				: {
						metadata: {
							...(optionalString(
								metadata.title,
								`resources[${index}].metadata.title`,
							) === undefined
								? {}
								: { title: metadata.title as string }),
							...(durationSeconds === undefined ? {} : { durationSeconds }),
							...(optionalString(
								metadata.codec,
								`resources[${index}].metadata.codec`,
							) === undefined
								? {}
								: { codec: metadata.codec as string }),
							...(channels === undefined ? {} : { channels: Number(channels) }),
						},
					}),
			...(expected === undefined
				? {}
				: {
						expected: {
							...(expected.sha256 === undefined
								? {}
								: { sha256: String(expected.sha256).toLowerCase() }),
							...(expected.decodedSha256 === undefined
								? {}
								: {
										decodedSha256: String(expected.decodedSha256).toLowerCase(),
									}),
						},
					}),
		};
	});
	return { schemaVersion: 1, resources };
}

export class ResourceCatalogIndex {
	readonly resources: readonly ResourceAlias[];

	constructor(resources: readonly ResourceAlias[]) {
		this.resources = [...resources];
	}

	search(
		query: string,
		filters: {
			rootId?: string;
			locale?: string;
			minDurationSeconds?: number;
			maxDurationSeconds?: number;
		} = {},
	): ResourceSearchMatch[] {
		const normalized = query.trim().toLocaleLowerCase();
		if (normalized.length === 0)
			throw new GarbroError(
				"INVALID_ARGUMENT",
				"Search query must not be empty",
			);
		const matches: ResourceSearchMatch[] = [];
		for (const resource of this.resources) {
			if (
				filters.rootId !== undefined &&
				resource.locator.source.rootId !== filters.rootId
			)
				continue;
			if (filters.locale !== undefined && resource.locale !== filters.locale)
				continue;
			const duration = resource.metadata?.durationSeconds;
			if (
				filters.minDurationSeconds !== undefined &&
				(duration === undefined || duration < filters.minDurationSeconds)
			)
				continue;
			if (
				filters.maxDurationSeconds !== undefined &&
				(duration === undefined || duration > filters.maxDurationSeconds)
			)
				continue;
			const values: Array<{
				matchedBy: ResourceSearchMatch["matchedBy"];
				value: string;
			}> = [
				...resource.aliases.map((value) => ({
					matchedBy: "alias" as const,
					value,
				})),
				...(resource.metadata?.title === undefined
					? []
					: [{ matchedBy: "title" as const, value: resource.metadata.title }]),
				{ matchedBy: "path", value: resource.locator.source.path },
			];
			const matched = values
				.map((candidate) => ({
					...candidate,
					normalized: candidate.value.toLocaleLowerCase(),
				}))
				.filter((candidate) => candidate.normalized.includes(normalized))
				.sort(
					(left, right) =>
						Number(right.normalized === normalized) -
						Number(left.normalized === normalized),
				)[0];
			if (matched !== undefined)
				matches.push({
					resource,
					matchedBy: matched.matchedBy,
					matchedValue: matched.value,
					exact: matched.normalized === normalized,
				});
		}
		return matches.sort(
			(left, right) =>
				Number(right.exact) - Number(left.exact) ||
				left.resource.locator.source.path.localeCompare(
					right.resource.locator.source.path,
				),
		);
	}
}
