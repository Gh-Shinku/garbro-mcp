// The aliases of the reference (`GameRes/FormatCatalog.AddAliases`, of the `ResourceAlias` exports of the
// reference's own files), which stand of the kinds of the resources the places of a name of a file stand of.
import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@garbro-mcp/formats";
import {
	ALIAS_TARGETS,
	GARBRO_ALIASES,
	aliasTargetsForExtension,
} from "../../packages/formats/src/shared/aliases.js";

describe("the aliases of the engine", () => {
	it("stands of the places of the names of the files the reference stands of", () => {
		expect(GARBRO_ALIASES.size).toBe(26);
		expect(GARBRO_ALIASES.get("osa")).toEqual(["BMP"]);
		expect(GARBRO_ALIASES.get("wf")).toEqual(["WAV"]);
		expect(GARBRO_ALIASES.get("cgr")).toEqual(["PSD"]);
		expect(GARBRO_ALIASES.get("psp")).toEqual(["PSB"]);
		expect(GARBRO_ALIASES.get("m")).toEqual(["MP3"]);
		expect(GARBRO_ALIASES.get("snd")).toEqual(["OGG"]);
		// Two of the places of a name stand of two kinds of a resource each.
		expect(GARBRO_ALIASES.get("str")).toEqual(["SCR", "TXT"]);
		expect(GARBRO_ALIASES.get("tbl")).toEqual(["DAT/GENERIC", "SCR"]);
		expect(GARBRO_ALIASES.get("wav")).toBeUndefined();
	});

	it("stands of the names of the resources of this project, of the kinds of the reference", () => {
		expect(ALIAS_TARGETS.size).toBe(GARBRO_ALIASES.size);
		expect(aliasTargetsForExtension("OSA")).toEqual(["gameres-bmp-image"]);
		expect(aliasTargetsForExtension(".glt")).toEqual(["gameres-bmp-image"]);
		expect(aliasTargetsForExtension("cgr")).toEqual(["adobe-psd-image"]);
		expect(aliasTargetsForExtension("psp")).toEqual(["cmvs-psb-image"]);
		expect(aliasTargetsForExtension("wf")).toEqual(["gameres-wav-audio"]);
		expect(aliasTargetsForExtension("m")).toEqual(["gameres-mp3-audio"]);
		expect(aliasTargetsForExtension("snd")).toEqual(["ogg-audio"]);
		expect(aliasTargetsForExtension("wav")).toEqual([]);
	});

	it("stands of the resources of the engine where the places of a name are looked over", () => {
		const registry = createDefaultRegistry();
		// A file of the place of a name `OSA` stands of the bitmap walk of this project, of which the
		// places of a name stand of no such place of their own.
		const aliased = registry.listFormatsForExtension("osa");
		expect(aliased.map((format) => format.id)).toEqual(["gameres-bmp-image"]);
		// A file of a place of a name the walk of a picture of this project stands of its own stands of
		// that walk, of no alias at all.
		const own = registry
			.listFormatsForExtension(".WAV")
			.map((format) => format.id);
		expect(own).toContain("gameres-wav-audio");
		// A file of the place of a name of an alias of a sound stands of the same walk, and the walk of
		// the places of a name of its own stands beside it.
		expect(
			registry.listFormatsForExtension("wf").map((format) => format.id),
		).toEqual(["gameres-wav-audio"]);
		expect(registry.listFormatsForExtension("nonesuch")).toEqual([]);
		expect(registry.listFormatsForExtension("")).toEqual([]);
	});
});
