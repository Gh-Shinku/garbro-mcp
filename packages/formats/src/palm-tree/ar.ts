// Format reference: GARBro ArcFormats/PalmTree/ArcAR.cs, classes `ArcOpener` and `ArPkStream`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import type { FormatDescriptor } from "@garbro-mcp/core";
import { PK_SIGNATURES, ZipFormat, type ZipSignatures } from "../pkware/zip.js";

/**
 * GARbro reads this variant by wrapping the file in a stream that rewrites the leading `AR` of every ZIP
 * block into `PK`, so the archive is an ordinary PKWARE container whose three signatures differ. Only those
 * three are rewritten: ZIP64 records keep their `PK` prefix, which means a ZIP64 archive in this format
 * finds no end record, exactly as in the reference.
 */
export const arSignatures: ZipSignatures = {
	endOfCentralDirectory: Buffer.from("AR\x05\x06", "binary"),
	centralDirectory: Buffer.from("AR\x01\x02", "binary"),
	localHeader: Buffer.from("AR\x03\x04", "binary"),
};

export const arDescriptor: FormatDescriptor = {
	id: "palm-tree-ar",
	name: "PalmTree script engine resource archive",
	extensions: ["arc"],
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
			source: "ArcFormats/PalmTree/ArcAR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `ArcOpener.TryOpen`. The reference first looks for the central-directory end signature and only
 * then hands the file to its ZIP reader under the `AR` signatures, which the port reproduces by sharing the
 * PKWARE reader with a different signature set. Everything else, including the entry handling and the
 * unsupported-encryption and unsupported-method errors, is the ZIP behavior described in that port's note.
 */
export const arFormat = new ZipFormat(arSignatures, arDescriptor);

/** The signature set the PKWARE port itself uses, re-exported so callers can contrast the two. */
export { PK_SIGNATURES };
