// Format reference: GARbro "Legacy/Mink/ImageGDF.cs", class `GdfFormat` (tag `GDF`, the obfuscated
// bitmap base class with a single fixed tag). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import type { ArchiveFormat, FormatDescriptor } from "@garbro-mcp/core";
import { obfuscatedBitmapFormat } from "../mb/image.js";

/** The reference compares the two leading bytes with `GD` before reconstructing the bitmap. */
const PREFIXES = ["GD"];

export const gdfImageDescriptor: FormatDescriptor = {
	id: "mink-gdf-image",
	name: "Mink obfuscated bitmap",
	extensions: ["gdf"],
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
			source: "Legacy/Mink/ImageGDF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gdfImageFormat: ArchiveFormat = obfuscatedBitmapFormat({
	descriptor: gdfImageDescriptor,
	prefixes: PREFIXES,
});
