// Format reference: GARbro ArcFormats/rUGP/ArcRIO.cs, classes `RioOpener` and `RioReader`, over the walks of
// `CRioArchive` (`packages/formats/src/rugp/rio-core.ts` and `rio-objects.ts`), with the key of an `.ici`
// payload of the engine. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The archive of this engine carries no table of entries: the places of the pictures and the sounds of a game
// are the places of the **nodes of a graph** the archive (or the `.ici` file beside it) carries, and the
// listing of the archive is the nodes of the classes the engine knows. Two kinds of archive stand behind the
// opener:
//
//  * a file that begins with the mark of the engine itself (`RioSignature`), whose graph stands of the file:
//    the places of a node are the places of the file.
//  * a file of no mark, whose graph stands of an `.ici` payload beside it: that payload names the index of
//    the game (`TocOffset`, `TocSize`), and the graph of the archive stands of the places of that index.
//
// One place of the reference is kept as it stands and is worth naming: the places of the index of the second
// kind stand of the count of the places of the head of the walk of the graph (`m_shift`), and the places of
// the **entries** of the listing stand of the count read out of the node alone, without that count. Both the
// port and the reference therefore hand an entry the place of its node rather than the place of it within the
// file where the index of the game stands of such a count.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";
import {
	decryptRioIci,
	readRioEncrypted,
	RIO_ENCRYPTED_SIGNATURE,
	RIO_ICI_KEY,
	RIO_SIGNATURE,
	RIO_SUPPORTED_CLASSES,
	RioStream,
} from "./rio-core.js";
import {
	RioArchive,
	RioObjectArcMan,
	type RioOceanNode,
} from "./rio-objects.js";

/** The places of the head of an `.ici` payload of the engine. */
const ICI_SUFFIX = ".ici";
/** The count of the places of the head of the walk of the graph of an archive of the second kind. */
const INDEX_SHIFT = 2;

export const rioDescriptor: FormatDescriptor = {
	id: "rugp-rio-archive",
	name: "rUGP engine resource archive",
	extensions: ["rio"],
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
			source: "ArcFormats/rUGP/ArcRIO.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** The name of a file within a path of either separator. */
function fileNameOf(path: string): string {
	const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return at < 0 ? path : path.slice(at + 1);
}

/**
 * `RioReader.Create`: the walk of an archive, of the file itself where it carries the mark of the engine and
 * of the `.ici` payload beside it where it does not.
 */
async function openRioReader(
	source: ByteSource,
	sourcePath: string,
): Promise<{ archive: RioArchive } | undefined> {
	if (source.size >= 4n) {
		const head = await source.readAt(0n, 4);
		if (head.readUInt32LE(0) === RIO_SIGNATURE) {
			// The graph of the archive stands of the file itself.
			const whole = await source.readAt(0n, Number(source.size));
			return { archive: new RioArchive(new RioStream(whole)) };
		}
	}
	// The payload beside the archive names the index of the game: the reference asks for the name of the file
	// with `.ici` behind it, and then for the name of the file of the archive with that behind it.
	const name = fileNameOf(sourcePath);
	const candidates = [name + ICI_SUFFIX];
	const stem = name.lastIndexOf(".");
	if (stem > 0) candidates.push(`${name.slice(0, stem)}${ICI_SUFFIX}`);
	let ici: Buffer | undefined;
	for (const candidate of candidates) {
		ici = await readCompanionFile(sourcePath, candidate);
		if (ici !== undefined) break;
	}
	if (ici === undefined) return undefined;
	const payload = readRioEncrypted(new RioStream(ici), RIO_ICI_KEY);
	if (payload === undefined) return undefined;
	let manifest: unknown;
	try {
		const walker = new RioArchive(new RioStream(decryptRioIci(payload)));
		manifest = walker.deserializeRoot();
	} catch {
		return undefined;
	}
	if (!(manifest instanceof RioObjectArcMan)) return undefined;
	const first = manifest.arcList.places.find(
		(one): one is NonNullable<typeof one> => one !== undefined,
	);
	if (!first || first.rioName === "") return undefined;
	if (fileNameOf(first.rioName).toLowerCase() !== name.toLowerCase()) {
		return undefined;
	}
	// The index of the game stands of the places the payload names, of the mark of an encrypted archive.
	let tocOffset = manifest.tocOffset;
	const tocSize = manifest.tocSize;
	if (tocSize <= 0 || BigInt(tocOffset) >= source.size) return undefined;
	let shift = 0;
	let signature = await readUInt32At(source, BigInt(tocOffset));
	if (signature !== RIO_ENCRYPTED_SIGNATURE) {
		tocOffset *= INDEX_SHIFT;
		if (BigInt(tocOffset) >= source.size) return undefined;
		signature = await readUInt32At(source, BigInt(tocOffset));
		if (signature !== RIO_ENCRYPTED_SIGNATURE) return undefined;
		shift = 1;
	}
	if (BigInt(tocOffset) + BigInt(tocSize) > source.size) return undefined;
	const toc = await source.readAt(BigInt(tocOffset), tocSize);
	return {
		archive: new RioArchive(new RioStream(toc), shift, true),
	};
}

async function readUInt32At(
	source: ByteSource,
	offset: bigint,
): Promise<number | undefined> {
	if (offset + 4n > source.size) return undefined;
	return (await source.readAt(offset, 4)).readUInt32LE(0);
}

/**
 * `RioOpener.TryOpen`: the graph of the archive, and the nodes of the classes the engine knows behind it. The
 * reference asks the graph of the game to stand of the box of its menu where the nodes of the listing stand
 * of no such class, which walks the graph of the box and leaves a graph of its own.
 */
async function readRioIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; version?: number } | undefined> {
	const reader = await openRioReader(source, sourcePath);
	if (!reader) return undefined;
	const root = reader.archive.deserializeRoot();
	const supported = (nodes: readonly RioOceanNode[]) =>
		nodes.filter((node) => RIO_SUPPORTED_CLASSES.has(node.className));
	let nodes = supported(reader.archive.loadNodes());
	if (nodes.length === 0) {
		const box = reader.archive
			.loadNodes()
			.find((node) => node.className === "CBoxOcean");
		if (!box) return undefined;
		reader.archive.readObject(box);
		nodes = supported(reader.archive.loadNodes());
	}
	const entries: FixedEntry[] = [];
	for (const node of nodes) {
		const mapped = RIO_SUPPORTED_CLASSES.get(node.className);
		if (mapped === undefined) continue;
		const path = normalizeEntryPath(node.getPathName()).path;
		const offset = BigInt(node.offset);
		const size = BigInt(node.size);
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				path,
				offset,
				size,
				encrypted: true,
				metadata: { kind: mapped, className: node.className },
			}),
		);
	}
	const version = root instanceof RioObjectArcMan ? root.version : undefined;
	return version === undefined ? { entries } : { entries, version };
}

/** `RioOpener.OpenEntry`, which is the walk of the engine of no cipher: the places of the node itself. */
const rioEntryOpener: FixedEntryOpener = async (source, entry) => {
	const data = await source.readAt(entry.offset, Number(entry.packedSize));
	return Readable.from([data]);
};

export const rioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: rioDescriptor,
	detection: {
		// The archive of the second kind carries no mark of its own — the reference names `0` among its
		// signatures as well — so the walk of the payload beside the file stands of the detection of it.
		signatures: [{ bytes: Buffer.from("cd326e59", "hex") }],
		priority: 0,
		extensionFallback: true,
	},
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		// The walk of the graph of an archive is the walk of the *listing* of it: what stands here is the two
		// kinds of archive the engine ships — the mark of it, and the `.ici` payload that names the index of a
		// game — so that an archive whose graph does not stand is still named as an archive of this engine and
		// refused where its entries are asked for.
		return (await openRioReader(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		let walked: { entries: FixedEntry[]; version?: number } | undefined;
		try {
			walked = await readRioIndex(source, sourcePath);
		} catch (error) {
			// The archive is named as an archive of this engine by its mark or by the payload beside it, and
			// the walk of its graph is the piece that did not stand: the places of the reference that stand
			// as `NotImplementedException` and the walks of a graph that does not stand are both named here
			// rather than left as a failure of the walk of the file.
			if (
				error instanceof GarbroError &&
				"UNSUPPORTED_FEATURE" === error.code
			) {
				throw error;
			}
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				"rUGP archive stands behind no graph this project walks",
				{ cause: error },
			);
		}
		if (!walked) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				"rUGP archive stands behind no graph this project walks",
			);
		}
		return {
			entries: walked.entries,
			metadata: {
				entryCount: walked.entries.length,
				...(walked.version === undefined ? {} : { version: walked.version }),
			},
		};
	},
	openEntry: rioEntryOpener,
});
