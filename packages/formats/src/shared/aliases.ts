// The aliases of the reference: `GameRes/FormatCatalog.AddAliases`, of the walks the reference stands of
// `[Export(typeof(ResourceAlias))]` in its own files. An alias stands of the places of a name of a file of
// one kind (`.OSA`), which stand of a resource of another kind (a bitmap): the reference stands of the kinds
// of the places of such a file where it names the kind of a file within an archive.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

/**
 * The aliases of the reference, of the places of the names of the files for the kinds of the resources the
 * reference stands of them. The places of a name stand of no place of a spot in front of them; the kinds
 * stand of the names the reference stands of the resources themselves.
 */
export const GARBRO_ALIASES: ReadonlyMap<string, readonly string[]> = new Map([
	["alp", ["DAT/GENERIC"]], // `Interheart/ArcFPK.cs`
	["anm", ["TXT"]], // `KiriKiri/ArcXP3.cs`
	["asd", ["TXT"]], // `KiriKiri/ArcXP3.cs`
	["bgm", ["WAV"]], // `Hypatia/ArcKogado.cs`
	["cgr", ["PSD"]], // `Legacy/Wing/ImageGEM.cs`
	["csf", ["DAT/GENERIC"]], // `FrontWing/ArcFLT.cs`
	["dow", ["WAV"]], // `Nekopunch/ArcPAK.cs`
	["gds", ["TXT"]], // `Entis/ArcNOA.cs`
	["glt", ["BMP"]], // `ArcFormats/ArcCommon.cs`
	["jcp", ["WAV"]], // `Abel/ArcFPK.cs`
	["m", ["MP3"]], // `Legacy/Sophia/ArcNOR.cs`
	["ne", ["WAV"]], // `Legacy/hmp/ImageCBF.cs`
	["osa", ["BMP"]], // `Legacy/Blucky/Aliases.cs`
	["psp", ["PSB"]], // `Will/ArcPulltop.cs`
	["scb", ["SCR"]], // `Legacy/Tetratech/ArcBND.cs`
	["sdt", ["SCR"]], // `Nekopunch/ArcPAK.cs`
	["snd", ["OGG"]], // `Hypatia/ArcKogado.cs`
	["snr", ["SCR"]], // `Otemoto/ArcTLZ.cs`
	["spt", ["SCR"]], // `Interheart/ArcFPK.cs`
	["str", ["SCR", "TXT"]], // `Legacy/Alterna/ArcBIN.cs` and `Rits/ArcSAF.cs`
	["tbl", ["DAT/GENERIC", "SCR"]], // `Kaguya/ArcKaguya.cs` and `Hypatia/ArcKogado.cs`
	["tmx", ["DAT/GENERIC"]], // `Tamamo/ArcPCK.cs`
	["wf", ["WAV"]], // `Legacy/Blucky/Aliases.cs`
	["wpn", ["TXT"]], // `Hypatia/ArcKogado.cs`
	["wps", ["SCR"]], // `Hypatia/ArcKogado.cs`
	["_bp", ["SCR"]], // `Ethornell/ArcBGI.cs`
]);

/**
 * The kinds of the reference of the aliases above, of the names this project stands of the same resources
 * in `docs/support-status.json`. A kind the reference stands of but this project carries no walk of stands
 * of nothing here, and the caller stands of no resource of such a file.
 */
const KINDS: ReadonlyMap<string, string> = new Map([
	["BMP", "gameres-bmp-image"],
	["MP3", "gameres-mp3-audio"],
	["OGG", "ogg-audio"],
	["PSB", "cmvs-psb-image"],
	["PSD", "adobe-psd-image"],
	["WAV", "gameres-wav-audio"],
]);

/**
 * The names of the resources of this project the places of a name stand of, of the aliases of the engine. A
 * name of no alias stands of nothing.
 */
/** The aliases of the reference, of the names this project stands of the same resources. */
export const ALIAS_TARGETS: ReadonlyMap<string, readonly string[]> = new Map(
	[...GARBRO_ALIASES].map(([extension, kinds]) => {
		const found: string[] = [];
		for (const kind of kinds) {
			const id = KINDS.get(kind);
			if (id && !found.includes(id)) found.push(id);
		}
		return [extension, found];
	}),
);

/**
 * The names of the resources of this project the places of a name stand of, of the aliases of the engine. A
 * name of no alias stands of nothing.
 */
export function aliasTargetsForExtension(extension: string): readonly string[] {
	return ALIAS_TARGETS.get(extension.replace(/^\./, "").toLowerCase()) ?? [];
}
