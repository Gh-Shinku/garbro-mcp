# The file-name aliases of the engine

GARbro keeps a small table beside its format registry that says: a file whose name ends in *one* extension
really holds a resource of *another* kind. These entries are the `ResourceAlias` exports of the reference
(`GARbro/GameRes/GameRes.cs`, `ResourceAlias` and `IResourceAliasMetadata`); `FormatCatalog.AddAliases`
(`GARbro/GameRes/FormatCatalog.cs`) turns each of them into an entry of its extension map, pairing the
extension the entry names with the format whose tag the entry names. The reference uses that map where it
names the kind of a file (`FormatCatalog.GetTypeFromName`), so a `.OSA` file is named a picture even though
no format claims the extension `OSA`.

The reference, at the baseline the rest of these notes use
(`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`), stands of these 26 extensions:

| extension | the kind of the resource | the reference file that names it |
| --- | --- | --- |
| `ALP` | `DAT/GENERIC` | `Interheart/ArcFPK.cs` |
| `ANM` | `TXT` | `KiriKiri/ArcXP3.cs` |
| `ASD` | `TXT` | `KiriKiri/ArcXP3.cs` |
| `BGM` | `WAV` | `Hypatia/ArcKogado.cs` |
| `CGR` | `PSD` | `Legacy/Wing/ImageGEM.cs` |
| `CSF` | `DAT/GENERIC` | `FrontWing/ArcFLT.cs` |
| `DOW` | `WAV` | `Nekopunch/ArcPAK.cs` |
| `GDS` | `TXT` | `Entis/ArcNOA.cs` |
| `GLT` | `BMP` | `ArcFormats/ArcCommon.cs` |
| `JCP` | `WAV` | `Abel/ArcFPK.cs` |
| `M` | `MP3` | `Legacy/Sophia/ArcNOR.cs` |
| `NE` | `WAV` | `Legacy/hmp/ImageCBF.cs` |
| `OSA` | `BMP` | `Legacy/Blucky/Aliases.cs` |
| `PSP` | `PSB` | `Will/ArcPulltop.cs` |
| `SCB` | `SCR` | `Legacy/Tetratech/ArcBND.cs` |
| `SDT` | `SCR` | `Nekopunch/ArcPAK.cs` |
| `SND` | `OGG` | `Hypatia/ArcKogado.cs` |
| `SNR` | `SCR` | `Otemoto/ArcTLZ.cs` |
| `SPT` | `SCR` | `Interheart/ArcFPK.cs` |
| `STR` | `SCR` and `TXT` | `Legacy/Alterna/ArcBIN.cs` and `Rits/ArcSAF.cs` |
| `TBL` | `DAT/GENERIC` and `SCR` | `Kaguya/ArcKaguya.cs` and `Hypatia/ArcKogado.cs` |
| `TMX` | `DAT/GENERIC` | `Tamamo/ArcPCK.cs` |
| `WF` | `WAV` | `Legacy/Blucky/Aliases.cs` |
| `WPN` | `TXT` | `Hypatia/ArcKogado.cs` |
| `WPS` | `SCR` | `Hypatia/ArcKogado.cs` |
| `_BP` | `SCR` | `Ethornell/ArcBGI.cs` |

## What this port does with them

`packages/formats/src/shared/aliases.ts` carries the table above verbatim, as the reference's own tags, and
resolves the tags to this project's format ids where the project carries a walk of that resource. Today the
project carries six of the nine kinds the table names — `BMP` (`gameres-bmp-image`), `PSD`
(`adobe-psd-image`), `PSB` (`cmvs-psb-image`), `WAV` (`gameres-wav-audio`), `MP3` (`gameres-mp3-audio`) and
`OGG` (`ogg-audio`) — while `DAT/GENERIC`, `TXT` and `SCR` stand of no format of their own here yet. An
alias whose kind stands of no walk resolves to nothing and is simply not offered.

`FormatRegistry.listFormatsForExtension` (`packages/core/src/registry.ts`) takes the aliases as an option and
hands back the formats of the extension itself first, then the formats an alias names. `createDefaultRegistry`
passes the table in, so a caller that asks which formats stand of `.OSA` is told the bitmap walk, and the
diagnosis the automation layer gives for a file no walk matched names that walk as well.

The relation to opening a file is narrower than it looks: at the reference's baseline the alias map reaches
only `GetTypeFromName`, while the four opening paths (`ArcFile.TryOpen`, `ImageFormat.Decode`,
`AudioFormat.Read`, `ScriptText.TryOpen`) resolve formats by signature and by a format's *own* extensions
(`FormatCatalog.FindFormats`). This port mirrors that: an alias widens the answer to "which formats could
stand of this name", not the answer to "which format opened this file".

## What is not carried

* Three of the kinds the table names stand of nothing in this project, and the reason is the reference rather
  than the port: `TXT` (`TextScriptFormat`), `SCR` (`BinScriptFormat`) and `DAT/GENERIC` (`DataFileFormat`)
  are `GenericScriptFormat`s (`GameRes/ScriptText.cs`), whose `Signature` is nought, whose `IsScript` answers
  `false` and whose `Read` and `Write` throw. `ScriptFormat.FindFormat` keeps only the formats whose
  `IsScript` answers `true`, so the reference itself never identifies a file as any of these three; they are
  registry entries for the alias table, and `DAT/GENERIC` even answers an empty `Type`. A port of them would
  be a row nothing could ever be detected as, so they are left alone. `AMP/LEAF` (`ArcFormats/Leaf/ArcPAK.cs`,
  class `AmpFormat`) is a fourth of the same shape: an empty `Type`, a `Signature` of nought and no
  extensions. The fifth kind of the table's targets that this project carries no walk of, `SCR` of the
  GsWin engine's three-word script (`ArcFormats/GsPack/ArcGsPack.cs`, class `GsScriptFormat`), is a walk of
  its own and **is** ported, as `gs-pack-scw-script`; note that the alias table's `SCR` target is the other
  class of the same name in `GameRes/ScriptText.cs`, not that one.
* The reference's `Type` field of an alias entry (`ResourceAlias` may name `archive`, `image`, `audio` or
  `script` and so narrow which registry the target is looked up in). At this baseline none of the 26 entries
  sets it, so every one of them is resolved across all formats, which is what this port does.
