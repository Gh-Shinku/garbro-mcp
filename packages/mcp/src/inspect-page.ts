import {
	type ArchiveAutomationService,
	type ArchiveInspection,
	entryToWire,
	type UnrecognizedFormatDiagnosis,
} from "@garbro-mcp/core";
import type { SavedResult } from "./result-page.js";

type Listing = Awaited<ReturnType<ArchiveAutomationService["listEntries"]>>;

export function unrecognizedSnapshot(
	path: string,
	diagnosis: UnrecognizedFormatDiagnosis,
	maxResponseBytes: number,
): SavedResult {
	const { candidateFormatIds, ...reason } = diagnosis;
	return {
		maxResponseBytes,
		recordCount: candidateFormatIds.length,
		compose: (start, count) => ({
			recognized: false,
			source: { path },
			diagnosis: {
				...reason,
				candidateFormatIds: candidateFormatIds.slice(start, start + count),
			},
		}),
	};
}

export function inspectSnapshot(
	inspection: ArchiveInspection,
	listing: Listing | undefined,
	options: {
		resourceType: string | undefined;
		includeMetadata: boolean;
		maxResponseBytes: number;
	},
): SavedResult {
	const source = { path: inspection.absolutePath };
	const extractSource = (id: string) => ({
		source,
		selection: { mode: "ids", entryIds: [id] },
	});
	const overview = listing?.overview;
	const samples =
		overview?.samples.map((sample) => ({
			...sample,
			extractSource: extractSource(sample.id),
		})) ?? [];
	const groups = overview?.groups ?? [];
	const entries = listing?.entries.map(entryToWire) ?? [];
	const window = listing && {
		archiveTotal: listing.archiveTotal,
		matchedTotal: listing.matchedTotal,
		offset: listing.offset,
		limit: listing.limit,
		nextOffset: listing.nextOffset,
	};
	const groupWindow = overview && {
		totalGroups: overview.totalGroups,
		nextGroupOffset: overview.nextGroupOffset,
	};
	const metadata = options.includeMetadata
		? Object.entries(inspection.metadata)
		: [];
	const warnings = inspection.warnings;
	const formatId = inspection.format.id;
	const details = {
		size: inspection.size.toString(),
		format: {
			id: formatId,
			name: inspection.format.name,
			extensions: inspection.format.extensions,
			resourceType: options.resourceType,
		},
		validation: inspection.validation,
		confidence: inspection.confidence,
		summary: inspection.summary,
	};
	return {
		maxResponseBytes: options.maxResponseBytes,
		recordCount:
			1 +
			samples.length +
			groups.length +
			entries.length +
			warnings.length +
			metadata.length,
		compose(start, count) {
			// The cursor spans these sections in order. Only slice the records
			// in the requested interval, keeping the existing wire shape.
			let sectionStart = 0;
			function take<T>(records: readonly T[]) {
				const from = Math.max(0, start - sectionStart);
				const to = Math.max(0, start + count - sectionStart);
				sectionStart += records.length;
				return records.slice(from, to);
			}
			const selectedSamples = take(samples);
			const [archiveDetails] = take([details]);
			const selectedGroups = take(groups);
			const selectedEntries = take(entries);
			const selectedWarnings = take(warnings);
			const selectedMetadata = take(metadata);
			return {
				recognized: true,
				source,
				format: { id: formatId },
				...archiveDetails,
				warnings: selectedWarnings,
				...(options.includeMetadata && {
					metadata: Object.fromEntries(selectedMetadata),
				}),
				...(window && {
					entries: {
						...window,
						...(groupWindow && {
							overview: {
								...groupWindow,
								groups: selectedGroups,
								samples: selectedSamples,
							},
						}),
						entries: selectedEntries,
					},
				}),
			};
		},
	};
}
