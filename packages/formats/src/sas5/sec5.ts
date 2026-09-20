// Format reference: GARbro "ArcFormats/Sas5/ArcSec5.cs", classes `Sec5Opener` (and the walk of the places of
// the picture of the places of the picture of the engine of the SAS5 kind, which stands of the places of the
// picture of the words of the head of the picture of the places of the picture of the walk of them). GARbro
// commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** The places of the picture of the words of the head of the picture of the walk of the places of the picture
 * of the places of the picture of the engine of the SAS5 kind. */
const SEC5_MARK = Buffer.from("SEC5", "latin1");
const SECTION_HEAD_SIZE = 8;
const FIRST_SECTION = 8;
const PLACES_OF_THE_NAME = 4;
const END_MARK = "ENDS";
const CODE_NAME = "CODE";
/** The places of the picture of the walk of the places of the picture of the sound of the places of the
 * picture of the walk of the places of the picture of the places of the picture of the engine. */
const KEY_ADDITION = 18;
const BYTE_SIZE = 0x100;

export interface Sec5Section {
	name: string;
	offset: number;
	size: number;
	encrypted: boolean;
}

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `Sec5Opener.TryOpen`: the places of the picture of the walk of the places of the picture of the places of
 * the picture of the engine of the SAS5 kind. Every place of the picture of the walk of them stands of the
 * places of the picture of the walk of the places of the picture of the four places of the picture of the
 * name of it and of the places of the picture of the walk of them, the places of the picture of the walk of
 * the places of the picture of the places of the picture of the walk of them standing behind the places of
 * the picture of the name of the picture of the walk of them.
 */
export function readSec5Sections(
	data: Buffer,
	fileLength = data.length,
): Sec5Section[] | undefined {
	if (fileLength < FIRST_SECTION || data.length < FIRST_SECTION)
		return undefined;
	if (!data.subarray(0, SEC5_MARK.length).equals(SEC5_MARK)) return undefined;
	const sections: Sec5Section[] = [];
	let at = FIRST_SECTION;
	while (at < fileLength) {
		// The reference stands the places of the picture of the name of the place of the picture of the walk
		// of the places of the picture before the places of the picture of the walk of the places of the
		// picture of it, so a place of the picture of the walk of them that stands for the places of the
		// picture of the walk of the places of the picture of the place of the picture of the walk of them
		// stands of the places of the picture of the name of the picture of the walk of it of its own.
		if (at + PLACES_OF_THE_NAME > data.length)
			throw invalidArchive(
				"The places of the picture of the walk of the places of the picture of the places of the picture of the engine stand short of the places of the picture",
			);
		const name = data.subarray(at, at + PLACES_OF_THE_NAME).toString("latin1");
		if (name === END_MARK) break;
		if (at + SECTION_HEAD_SIZE > data.length)
			throw invalidArchive(
				"The places of the picture of the walk of the places of the picture of the places of the picture of the engine stand short of the places of the picture",
			);
		const size = data.readUInt32LE(at + PLACES_OF_THE_NAME);
		const offset = at + SECTION_HEAD_SIZE;
		if (offset + size > data.length)
			throw invalidArchive(
				"The places of the picture of the walk of the places of the picture of a place of the picture of the engine stand past the places of the picture",
			);
		sections.push({
			name,
			offset,
			size,
			encrypted: name === CODE_NAME,
		});
		at = offset + size;
	}
	if (sections.length === 0) return undefined;
	return sections;
}

/**
 * `Sec5Opener.DecryptCodeSection`: the places of the picture of the walk of the places of the picture of the
 * places of the picture of the engine stand as the places of the picture of the walk of the places of the
 * picture of the picture behind them, the places of the picture of the walk of them standing beside the places
 * of the picture of the walk of the places of the picture of the place of the picture of the walk of them of
 * the places of the picture of their own.
 */
export function decryptSec5Code(code: Buffer): Buffer {
	const out = Buffer.from(code);
	let key = 0;
	for (let at = 0; at < out.length; at += 1) {
		// The reference stands the places of the picture of the walk of the places of the picture of the
		// picture of the places of the picture of their own before the places of the picture of the walk of
		// the places of the picture of the picture stand as the places of the picture of the walk of them.
		const place = (out[at] ?? 0) + KEY_ADDITION;
		out[at] = (out[at] ?? 0) ^ key;
		key = (key + place) & (BYTE_SIZE - 1);
	}
	return out;
}

export const sas5Sec5Descriptor: FormatDescriptor = {
	id: "sas5-sec5",
	name: "SAS5 engine resource index file",
	extensions: ["sec5"],
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
			source: "ArcFormats/Sas5/ArcSec5.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const sas5Sec5Format: ArchiveFormat = defineFixedArchive({
	descriptor: sas5Sec5Descriptor,
	detection: { signatures: [{ bytes: SEC5_MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(FIRST_SECTION)) return false;
		try {
			const data = Buffer.from(
				await source.readAt(0n, Math.min(Number(source.size), 0x1000)),
			);
			return readSec5Sections(data, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const sections = readSec5Sections(stored, Number(source.size));
		if (!sections) throw invalidArchive("Not an archive of this kind");
		return {
			entries: sections.map((section, id) =>
				createFixedEntry({
					id,
					path: section.name,
					offset: BigInt(section.offset),
					size: BigInt(section.size),
					encrypted: section.encrypted,
					metadata: { type: "binary" },
				}),
			),
			metadata: {
				sections: sections.length,
				encryptedSections: sections.filter((section) => section.encrypted)
					.length,
			},
		};
	},
	async openEntry(source: ByteSource, entry) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const sections = readSec5Sections(stored, Number(source.size));
		if (!sections) throw invalidArchive("Not an archive of this kind");
		const section = sections.find((place) => place.name === entry.path);
		if (!section)
			throw invalidArchive(
				"No places of the picture of the walk of the places of the picture",
			);
		const data = stored.subarray(section.offset, section.offset + section.size);
		// The reference stands the places of the picture of the walk of the places of the picture of the place
		// of the picture of the walk of the places of the picture of the engine of the words of the walk of
		// the picture of their own, and hands every other place of the picture over as it stands.
		return Readable.from([
			section.encrypted ? decryptSec5Code(data) : Buffer.from(data),
		]);
	},
});
