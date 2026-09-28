import type { ArchiveEntry, EntryResourceType } from "@garbro-mcp/core";
import { GARBRO_ALIASES } from "./aliases.js";
import { changeExtension } from "./companion.js";
import { garbroResourceCatalog } from "./resource-catalog.generated.js";

type CatalogType = Exclude<EntryResourceType, "unknown">;
interface CatalogRecord {
	type: CatalogType;
	tag: string | null;
	extensions: readonly string[];
	signatures: readonly number[];
}

export interface ResourceClassification {
	resourceType: CatalogType;
	extension?: string;
	referenceTag: string;
}

const byExtension = new Map<string, CatalogRecord[]>();
const bySignature = new Map<number, CatalogRecord[]>();
const byTag = new Map<string, CatalogRecord[]>();

for (const resource of garbroResourceCatalog) {
	if (resource.tag !== null) {
		const tagged = byTag.get(resource.tag) ?? [];
		tagged.push(resource);
		byTag.set(resource.tag, tagged);
	}
	for (const extension of resource.extensions) {
		const normalized = extension.replace(/^\./, "").toLowerCase();
		if (normalized.length === 0) continue;
		const matches = byExtension.get(normalized) ?? [];
		matches.push(resource);
		byExtension.set(normalized, matches);
	}
	for (const signature of resource.signatures) {
		if (signature === 0) continue;
		const matches = bySignature.get(signature) ?? [];
		matches.push(resource);
		bySignature.set(signature, matches);
	}
}

function classification(resource: CatalogRecord): ResourceClassification {
	const result: ResourceClassification = {
		resourceType: resource.type,
		referenceTag: resource.tag ?? "",
	};
	const extension = resource.extensions.find(
		(candidate) => candidate.length > 0,
	);
	if (extension !== undefined) result.extension = extension;
	return result;
}

function uniquelyTyped(
	resources: readonly CatalogRecord[],
): ResourceClassification | undefined {
	const first = resources[0];
	if (!first) return undefined;
	const types = new Set(resources.map((resource) => resource.type));
	if (types.size !== 1) return undefined;
	return classification(first);
}

function exactTag(tag: string): ResourceClassification | undefined {
	const resources = byTag.get(tag);
	const resource = resources?.length === 1 ? resources[0] : undefined;
	return resource ? classification(resource) : undefined;
}

/** Classify a named entry through GARBro's extension catalogue and alias table. */
export function classifyResourceExtension(
	path: string,
): ResourceClassification | undefined {
	const separator = path.lastIndexOf(".");
	if (separator === -1) return undefined;
	const extension = path.slice(separator + 1).toLowerCase();
	if (extension.length === 0) return undefined;
	const resources = [...(byExtension.get(extension) ?? [])];
	for (const tag of GARBRO_ALIASES.get(extension) ?? [])
		for (const resource of byTag.get(tag) ?? [])
			if (!resources.includes(resource)) resources.push(resource);
	return uniquelyTyped(resources);
}

/** Classify a four-byte little-endian signature with GARBro AutoEntry's special cases. */
export function classifyResourceSignature(
	signature: number,
): ResourceClassification | undefined {
	const normalized = signature >>> 0;
	if (normalized === 0x5367674f) return exactTag("OGG");
	if (normalized === 0x46464952) return exactTag("WAV");
	if ((normalized & 0xffff) === 0x4d42) return exactTag("BMP");
	const resources = bySignature.get(normalized) ?? [];
	const resource = resources.length === 1 ? resources[0] : undefined;
	return resource ? classification(resource) : undefined;
}

/** Apply extension evidence without changing the stored entry name. */
export function applyExtensionResourceType(entry: ArchiveEntry): void {
	const detected = classifyResourceExtension(entry.path);
	if (detected) entry.resourceType = detected.resourceType;
}

/** Apply extension evidence to every entry in an archive index. */
export function applyExtensionResourceTypes(
	entries: readonly ArchiveEntry[],
): void {
	for (const entry of entries) applyExtensionResourceType(entry);
}

/** Apply signature evidence and give generated names the detected format's primary extension. */
export function applySignatureResourceType(
	entry: ArchiveEntry,
	signature: number,
): void {
	const detected = classifyResourceSignature(signature);
	if (!detected) return;
	entry.resourceType = detected.resourceType;
	if (detected.extension)
		entry.path = changeExtension(entry.path, detected.extension);
}
