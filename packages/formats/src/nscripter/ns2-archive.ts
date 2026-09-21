// Format reference: GARbro "ArcFormats/NScripter/ArcNS2.cs", class `Ns2Opener` - its plain index, which is
// the way a stock build reads a container of this engine. The reference's other way needs a password the
// person running it supplies (`QueryPassword`), and `KnownKeys` ships as an empty dictionary, so it stands
// outside this port. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError, decodeCp932 } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The head of the file names where its index ends and its data begins. */
const HEADER_SIZE = 4;
/** The longest name the reference holds. */
const NAME_BUFFER_SIZE = 0x100;
/** Every record of the index opens with this character. */
const RECORD_MARK = 0x22;
/** The kinds of thing an entry may hold, as the name's own extension tells it. */
const KIND_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
	["bmp", "image"],
	["png", "image"],
	["jpg", "image"],
	["ogg", "audio"],
	["wav", "audio"],
	["txt", "script"],
	["nsa", "script"],
	["dat", "data"],
	["bin", "data"],
]);
/** An archive this project is willing to read. */
const LIMIT = 256 * 1024 * 1024;

export interface Ns2EntryPlan {
	name: string;
	offset: number;
	size: number;
}

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `Ns2Opener.ReadIndex`: the head names the place the data begins, and the index between the head and that
 * place is a run of records - a quote, a name, a quote, and the size of the entry. The entries themselves
 * stand one behind the other from the place the head named. A record that does not open with a quote ends
 * the walk, and a name that is empty, too long, or an entry that reaches past the file is refused.
 */
export function readNs2Index(data: Buffer): Ns2EntryPlan[] | undefined {
	if (data.length <= HEADER_SIZE) return undefined;
	const baseOffset = data.readUInt32LE(0);
	if (baseOffset <= HEADER_SIZE || baseOffset >= data.length) return undefined;
	const plans: Ns2EntryPlan[] = [];
	let at = HEADER_SIZE;
	let current = baseOffset;
	while (at < baseOffset) {
		if (RECORD_MARK !== (data[at] ?? 0)) break;
		at += 1;
		let end = at;
		while (end < data.length && RECORD_MARK !== (data[end] ?? 0)) end += 1;
		const length = end - at;
		// The reference gives up on a name that fills its whole buffer, and on one of nothing.
		if (length >= NAME_BUFFER_SIZE || 0 === length) return undefined;
		const name = decodeCp932(data.subarray(at, end));
		at = end + 1;
		if (at + 4 > data.length) return undefined;
		const size = data.readUInt32LE(at);
		at += 4;
		if (!checkPlacement(BigInt(current), BigInt(size), BigInt(data.length))) {
			return undefined;
		}
		plans.push({ name, offset: current, size });
		current += size;
	}
	return plans.length > 0 ? plans : undefined;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const ns2ArchiveDescriptor: FormatDescriptor = {
	id: "nscripter-ns2-archive",
	name: "NScripter engine resource archive",
	extensions: ["ns2"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/NScripter/ArcNS2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ns2ArchiveFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ns2ArchiveDescriptor,
	// The container writes no word of its own, and the reference tries this index for any file at all.
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size <= BigInt(HEADER_SIZE)) return false;
		return readNs2Index(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const stored = await readStored(source);
		const plans = readNs2Index(stored);
		if (!plans) throw invalid("Not an NScripter engine resource archive");
		const entries: FixedEntry[] = [];
		for (const [index, plan] of plans.entries()) {
			if (plan.size > LIMIT) {
				throw invalid("An entry is larger than this project will read");
			}
			const extension = plan.name.replace(/^.*\./, "").toLowerCase();
			const kind = KIND_BY_EXTENSION.get(extension);
			entries.push(
				createFixedEntry({
					id: index,
					path: plan.name,
					offset: BigInt(plan.offset),
					size: BigInt(plan.size),
					metadata: {
						...(kind ? { type: kind } : {}),
					},
				}),
			);
		}
		return {
			entries,
			metadata: { dataOffset: plans[0]?.offset ?? HEADER_SIZE },
		};
	},
	async openEntry(source: ByteSource, entry) {
		// The plain container keeps its entries as they stand.
		return Readable.from([
			Buffer.from(await source.readAt(entry.offset, Number(entry.size))),
		]);
	},
});
