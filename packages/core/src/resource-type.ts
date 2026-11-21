import type { ArchiveEntry } from "./types.js";

/**
 * A conservative classification for an archive entry. This is deliberately a
 * resource category, not a semantic claim about who or what uses the file.
 */
export const entryResourceTypes = [
	"archive",
	"audio",
	"font",
	"image",
	"script",
	"video",
	"unknown",
] as const;
export type EntryResourceType = (typeof entryResourceTypes)[number];

const extensionTypes: Record<string, Exclude<EntryResourceType, "unknown">> = {
	// Audio containers and codecs commonly found in ADV games.
	".aac": "audio",
	".acb": "audio",
	".awb": "audio",
	".flac": "audio",
	".m4a": "audio",
	".mid": "audio",
	".midi": "audio",
	".mp3": "audio",
	".nwa": "audio",
	".ogg": "audio",
	".opus": "audio",
	".wav": "audio",
	".wma": "audio",
	".avi": "video",
	".m2v": "video",
	".m4v": "video",
	".mkv": "video",
	".mov": "video",
	".mp4": "video",
	".mpeg": "video",
	".mpg": "video",
	".ogv": "video",
	".webm": "video",
	".wmv": "video",
	".otc": "font",
	".otf": "font",
	".ttc": "font",
	".ttf": "font",
	".woff": "font",
	".woff2": "font",
	// Common image formats, including several visual-novel formats.
	".bmp": "image",
	".dds": "image",
	".gif": "image",
	".ico": "image",
	".jpeg": "image",
	".jpg": "image",
	".png": "image",
	".psd": "image",
	".tga": "image",
	".webp": "image",
	// Script and scenario formats seen in supported archives.
	".js": "script",
	".json": "script",
	".ks": "script",
	".lua": "script",
	".scn": "script",
	".tjs": "script",
	".txt": "script",
	".xml": "script",
};

function metadataType(entry: ArchiveEntry): EntryResourceType | undefined {
	const metadata = entry.metadata;
	if (metadata === undefined) return undefined;
	for (const key of ["resourceType", "mediaType", "type"]) {
		const value = metadata[key];
		if (typeof value !== "string") continue;
		const normalized = value.toLowerCase().split("/", 1)[0] ?? "";
		if ((entryResourceTypes as readonly string[]).includes(normalized))
			return normalized as EntryResourceType;
	}
	return undefined;
}

/** Return a best-effort type, preserving `unknown` when evidence is absent. */
export function entryResourceType(entry: ArchiveEntry): EntryResourceType {
	if (entry.resourceType !== undefined) return entry.resourceType;
	const explicit = metadataType(entry);
	if (explicit !== undefined) return explicit;
	const lastDot = entry.path.lastIndexOf(".");
	if (lastDot === -1) return "unknown";
	return extensionTypes[entry.path.slice(lastDot).toLowerCase()] ?? "unknown";
}
