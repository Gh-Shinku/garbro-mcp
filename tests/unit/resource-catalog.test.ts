import { entryResourceType, type ArchiveEntry } from "@garbro-mcp/core";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
	applySignatureResourceType,
	classifyResourceExtension,
	classifyResourceSignature,
} from "../../packages/formats/src/shared/resource-catalog.js";
import { garbroResourceCatalog } from "../../packages/formats/src/shared/resource-catalog.generated.js";

function entry(path: string): ArchiveEntry {
	return {
		id: "0",
		path,
		size: 1n,
		packedSize: 1n,
		compressed: false,
		encrypted: false,
	};
}

describe("GARBro resource catalogue", () => {
	it("is generated from every inventory row", async () => {
		const inventory = JSON.parse(
			await readFile("docs/garbro-inventory.json", "utf8"),
		);
		expect(garbroResourceCatalog).toEqual(
			inventory.formats.map(
				({ type, tag, extensions, signatures }: CatalogFixture) => ({
					type,
					tag,
					extensions,
					signatures,
				}),
			),
		);
		expect(
			garbroResourceCatalog.find(
				(resource) => resource.tag === "OGG" && resource.type === "audio",
			),
		).toMatchObject({
			extensions: ["ogg"],
			signatures: [0x5367674f, 0],
		});
	});

	it("classifies extensions and GARBro aliases conservatively", () => {
		expect(classifyResourceExtension("voice.ogg")?.resourceType).toBe("audio");
		expect(classifyResourceExtension("picture.osa")?.resourceType).toBe(
			"image",
		);
		expect(classifyResourceExtension("payload.dat")).toBeUndefined();
	});

	it("handles AutoEntry special signatures and rejects ambiguous ones", () => {
		expect(classifyResourceSignature(0x5367674f)?.referenceTag).toBe("OGG");
		expect(classifyResourceSignature(0x12344d42)?.referenceTag).toBe("BMP");
		expect(classifyResourceSignature(0x01575054)).toBeUndefined();
	});

	it("stores explicit resource types and renames signature-classified entries", () => {
		const archiveEntry = entry("nested.bin");
		archiveEntry.resourceType = "archive";
		expect(entryResourceType(archiveEntry)).toBe("archive");

		const audioEntry = entry("voice#0001");
		applySignatureResourceType(audioEntry, 0x5367674f);
		expect(audioEntry.path).toBe("voice#0001.ogg");
		expect(entryResourceType(audioEntry)).toBe("audio");
	});
});

interface CatalogFixture {
	type: "archive" | "audio" | "image" | "script";
	tag: string | null;
	extensions: string[];
	signatures: number[];
}
