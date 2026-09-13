// Format reference: GARbro "Legacy/Brownie/ImageNGW.cs", class `NgwFormat` (tag `NGW`, the obfuscated
// bitmap base class with a single fixed tag). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import type { ArchiveFormat, FormatDescriptor } from "@garbro-mcp/core";
import { obfuscatedBitmapFormat } from "../mb/image.js";

/** The reference compares the two leading bytes with `NG` before reconstructing the bitmap. */
const PREFIXES = ["NG"];

export const ngwImageDescriptor: FormatDescriptor = {
	id: "brownie-ngw-image",
	name: "Brownie obfuscated bitmap",
	extensions: ["ngw"],
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
			source: "Legacy/Brownie/ImageNGW.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ngwImageFormat: ArchiveFormat = obfuscatedBitmapFormat({
	descriptor: ngwImageDescriptor,
	prefixes: PREFIXES,
});
