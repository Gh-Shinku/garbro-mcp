// Port of GARbro "ArcFormats/Emote/ArcPSB.cs" (class `PsbOpener`), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. The archive of the E-mote engine: a PSB container
// whose root dictionary holds the pictures, the layers and the chunks of the archive, and whose every entry
// stands of the places of a chunk of the file.
//
// The reference reads the pictures of a texture with a decoder of its own (`PsbTextureDecoder`, of the
// places of the picture of the engine) and a picture of the name `TLG` through the TLG format. This stage of
// the port reads the archive and hands the places of a chunk over as they stand; the pictures of the engine
// stand in the stage behind it.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";
import { PsbReader, type PsbValue } from "./psb-reader.js";
import { decodePsbTexture } from "./psb-texture.js";

const BASELINE_COMMIT = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";
/** `PsbOpener.KnownKeys`: the key of the games the reference holds a key of. */
export const PSB_KNOWN_KEYS: readonly number[] = [970396437];

interface PsbEntryPlan {
	name: string;
	offset: number;
	size: number;
	picture: boolean;
	metadata: Record<string, unknown>;
}

/** A count of an object of the file, of the name the object stands of. */
function numberOf(value: PsbValue | undefined, name: string): number {
	if ("number" !== typeof value) {
		throw invalidArchive(
			`The object \`${name}\` of the archive stands of no count`,
		);
	}
	return value;
}

function mapOf(value: PsbValue | undefined): Map<string, PsbValue> | undefined {
	return value instanceof Map ? value : undefined;
}

function chunkOf(
	value: PsbValue | undefined,
): { offset: number; length: number } | undefined {
	if (value && "object" === typeof value && "chunk" in value) {
		return value.chunk;
	}
	return undefined;
}

/** `PsbReader.GetChunks`: every object of the root dictionary that stands of a chunk of the file. */
function planChunks(reader: PsbReader): PsbEntryPlan[] | undefined {
	const root = reader.dict(reader.header.root);
	const plans: PsbEntryPlan[] = [];
	for (const [name, value] of root) {
		const chunk = chunkOf(value);
		if (!chunk || 0 === name.length) continue;
		plans.push({
			name,
			offset: reader.header.chunkData + chunk.offset,
			size: chunk.length,
			picture: false,
			metadata: { type: "file" },
		});
	}
	return 0 === plans.length ? undefined : plans;
}

/** `PsbReader.GetTextures`: the pictures the dictionary of the source of the archive stands of. */
function planTextures(reader: PsbReader): PsbEntryPlan[] | undefined {
	const source = mapOf(reader.rootKey("source"));
	if (!source || 0 === source.size) return undefined;
	const plans: PsbEntryPlan[] = [];
	for (const [name, value] of source) {
		const item = mapOf(value);
		if (!item) continue;
		const texture = mapOf(item.get("texture"));
		if (texture) {
			const pixel = chunkOf(texture.get("pixel"));
			if (!pixel) continue;
			plans.push({
				name,
				offset: reader.header.chunkData + pixel.offset,
				size: pixel.length,
				picture: true,
				metadata: {
					type: "image",
					textureType: String(texture.get("type") ?? ""),
					width: numberOf(texture.get("width"), "width"),
					height: numberOf(texture.get("height"), "height"),
					truncatedWidth: numberOf(
						texture.get("truncated_width"),
						"truncated_width",
					),
					truncatedHeight: numberOf(
						texture.get("truncated_height"),
						"truncated_height",
					),
				},
			});
			continue;
		}
		const icons = mapOf(item.get("icon"));
		if (!icons) continue;
		for (const [iconName, iconValue] of icons) {
			const layer = mapOf(iconValue);
			if (!layer) continue;
			const pixel = chunkOf(layer.get("pixel"));
			if (!pixel) continue;
			const width = numberOf(layer.get("width"), "width");
			const height = numberOf(layer.get("height"), "height");
			plans.push({
				name: `${name}#${iconName}`,
				offset: reader.header.chunkData + pixel.offset,
				size: pixel.length,
				picture: true,
				metadata: {
					type: "image",
					width,
					height,
					truncatedWidth: width,
					truncatedHeight: height,
					offsetX: numberOf(layer.get("originX"), "originX"),
					offsetY: numberOf(layer.get("originY"), "originY"),
					textureType:
						undefined === layer.get("compress")
							? "RGBA8"
							: String(layer.get("compress")),
				},
			});
		}
	}
	return 0 === plans.length ? undefined : plans;
}

/** `PsbReader.GetLayers`: the layers of the archive, of the chunks their own names stand of. */
function planLayers(reader: PsbReader): PsbEntryPlan[] | undefined {
	const layers = reader.rootKey("layers");
	if (!Array.isArray(layers) || 0 === layers.length) return undefined;
	const plans: PsbEntryPlan[] = [];
	for (const value of layers) {
		const layer = mapOf(value);
		if (!layer) continue;
		const name = `${numberOf(layer.get("layer_id"), "layer_id")}.tlg`;
		const chunk = chunkOf(reader.rootKey(name));
		if (!chunk) continue;
		plans.push({
			name,
			offset: reader.header.chunkData + chunk.offset,
			size: chunk.length,
			picture: true,
			metadata: {
				type: "image",
				textureType: "TLG",
				offsetX: numberOf(layer.get("left"), "left"),
				offsetY: numberOf(layer.get("top"), "top"),
				width: numberOf(layer.get("width"), "width"),
				height: numberOf(layer.get("height"), "height"),
			},
		});
	}
	return 0 === plans.length ? undefined : plans;
}

/**
 * `PsbOpener.TryOpen`: the archive of a file of the container of the engine, of the key of the game where
 * the file stands of the cipher of the engine.
 */
export function readEmotePsbIndex(data: Buffer): PsbEntryPlan[] | undefined {
	let reader = PsbReader.parse(data, { key: PSB_KNOWN_KEYS[0] ?? 0 });
	if (!reader) {
		const plain = PsbReader.parse(data);
		if (!plain) return undefined;
		if (0 !== (plain.header.flags & 2)) return undefined;
		reader = plain;
	}
	return planTextures(reader) ?? planLayers(reader) ?? planChunks(reader);
}

export const emotePsbDescriptor: FormatDescriptor = {
	id: "emote-psb-archive",
	name: "E-mote engine texture container",
	extensions: ["psb", "pimg", "dpak", "psbz", "psp"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Emote/ArcPSB.cs",
			license: "MIT",
			commit: BASELINE_COMMIT,
		},
	],
};

/**
 * `PsbOpener.OpenEntry`: the places of a chunk of the file, which stand handed over as they stand, and the
 * picture of a texture of the engine, which stands of the kind of the picture the archive names. A picture
 * of the name `TLG` stands in the stage of the pictures of that name behind this one, so its places stand
 * handed over as they stand.
 */
export const emotePsbEntryOpener: FixedEntryOpener = async (source, entry) => {
	const data = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	const metadata = (entry.metadata ?? {}) as Record<string, unknown>;
	const texType = metadata.textureType;
	if ("image" !== metadata.type || "string" !== typeof texType) {
		return Readable.from([data]);
	}
	if ("TLG" === texType) return Readable.from([data]);
	const picture = decodePsbTexture(data, {
		texType,
		fullWidth: Number(metadata.width ?? 0),
		fullHeight: Number(metadata.height ?? 0),
		width: Number(metadata.truncatedWidth ?? metadata.width ?? 0),
		height: Number(metadata.truncatedHeight ?? metadata.height ?? 0),
	});
	if (!picture) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`The picture of the engine of the kind \`${texType}\` stands of a walk this project does not carry`,
		);
	}
	return Readable.from([picture]);
};

export const emotePsbFormat: ArchiveFormat = defineFixedArchive({
	descriptor: emotePsbDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("PSB", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			const data = Buffer.from(await source.readAt(0n, Number(source.size)));
			return readEmotePsbIndex(data) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, _sourcePath: string) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const plans = readEmotePsbIndex(data);
		if (!plans) throw invalidArchive("Not an archive of the E-mote engine");
		const names = new Set<string>();
		const entries: FixedEntry[] = plans.map((plan, id) => {
			if (names.has(plan.name)) {
				throw invalidArchive("The archive stands of two files of one name");
			}
			names.add(plan.name);
			return {
				...createFixedEntry({
					id,
					path: plan.name,
					offset: BigInt(plan.offset),
					size: BigInt(plan.size),
					compressed: false,
					metadata: plan.metadata,
				}),
				sizeKnown: true,
			} as FixedEntry;
		});
		return {
			entries,
			metadata: {
				count: entries.length,
				pictures: plans.filter((plan) => plan.picture).length,
			},
		};
	},
	openEntry: emotePsbEntryOpener,
});

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}
