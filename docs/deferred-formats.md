# Formats this project does not read, and why

This file records why each GARbro engine this project does not read stays unread, so that the screening is
not repeated for every one of them. Every entry names the reference file and the identifier the reason
rests on, so that the reason can be re-checked against the reference without repeating the screening.

`docs/support-status.json` records what every format this project *does* read supports; this file records
the other side of that line. All findings below were read off the GARbro baseline commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`.

## The reference does not compile, or stops before it reads anything

There is no reading algorithm to port, because the reference itself never reaches one.

- `EMS` (`ArcFormats/Entis/AudioEMS.cs`) calls `CreateDecoderSymbolTable` at line 156 and `DecodeSymbols`
  at line 162. Both names occur in that file and nowhere else in the tree: they are never defined, so the
  file does not compile.
- `MCP` (`Legacy/Mink/ImageMCP.cs`) ends its `ReadMetaData` at line 39 with an object initializer whose
  closing `};` is missing — the file does not compile. `Read` also refers to a type names `xxxMetaData`.
- `LPC` (`ArcFormats/Hypatia/ArcLPC.cs`) reads a count at offset 4 and then builds every entry with
  `Create<Entry> (name)`, where `name` is not declared in the method and no offset or size is read.
- `AF2` (`ArcFormats/CsWare/AudioAF2.cs`) ends at `format.SetBPS()` and returns no `SoundInput`.
- `BIN/DXLIB` (`ArcFormats/DxLib/ArcDX8.cs`) reaches `return null;` with its `// decrypt-2` and
  `// decompress` steps still standing as comments rather than as code.

## The key is not in the archive

These archives carry no usable key; the reference asks the user, and its own default scheme ships empty.
A port cannot read such a file without a key the file does not contain, so a port would only be able to
open archives that the shipped defaults already cover.

- `ACV` (`ArcFormats/NonColor/ArcACV.cs`, `QueryScheme` at line 51) and `DAT/MINATO`
  (`ArcFormats/NonColor/ArcMinato.cs`, `QueryScheme` at line 68, with `NcSchemeCrc32` beside it).
- `PKZ` (`ArcFormats/Sviu/ArcPKZ.cs`), `PKG/2` (`ArcFormats/Yatagarasu/ArcPKG2.cs`),
  `ADS` (`ArcFormats/BlackRainbow/ArcADS.cs`), `PBZ` (`ArcFormats/Cmvs/ArcPBZ.cs`),
  `ARC/FOMA` (`Legacy/StudioFoma/ArcARC.cs`), `ARC/AI5WIN` (`ArcFormats/elf/ArcAi5Win.cs`) and
  `CG/ACTGS` with `CG/ACTGS/2` (`ArcFormats/Actgs/ArcCG.cs`) all reach their key through a `Scheme` with
  a `KnownKeys` table.
- `ASSETS/UNITY` (`ArcFormats/Unity/ArcASSET.cs`) reads a `Key` of the same kind.
- `OGG/TINK` (`ArcFormats/Cyberworks/AudioTINK.cs`) holds `TinkAudioScheme.KnownKeys` as an empty
  dictionary in the shipped default.
- `PAK/MORNING` (`ArcFormats/Morning/ArcPAK.cs`) reads `DefaultKey`.
- `DXA` (`ArcFormats/DxLib/ArcDX.cs`) ships both `DefaultScheme` and `KnownKeys` empty and asks for the
  key through `WidgetSCR.xaml`, i.e. through the person reading the file.
- `GPK/STACK` (`ArcFormats/Stack/ArcGPK.cs`) reads the resource `CIPHERCODE` out of an executable placed
  beside the archive.
- `PAK/EAGLS` (`ArcFormats/Eagls/ArcEAGLS.cs`) asks for its encryption through `Query<EaglsOptions>` and
  then calls `DetectEncryptionScheme` on what the answer holds.
- `BIN/PAC` (`ArcFormats/DigitalWorks/ArcBIN.cs`) reaches its key through a `Scheme` whose `DefaultScheme`
  ships without one.
- `CRZ` (`ArcFormats/Crowd/ImageCRZ.cs`) is an `SZDD` stream, which this project can already walk, behind
  a header whose key comes from `CrzScheme.KnownKeys`, empty in the shipped `DefaultScheme`.

## The index is not in the archive

The names, sizes and order of the entries come from a listing that GARbro keeps beside the games rather
than inside the archive, so a game file alone cannot be walked.

- `MBM` (`Legacy/Logg/ArcMBM.cs`) selects a listing by archive size (`0x0AB0F5F4` to `logg_pl.lst`,
  `0x0BFFD3DA` to `logg_ak.lst`, `0x09809196` to `logg_th.lst`).
- `PACK/BONK` (`ArcFormats/Bonk/ArcPACK.cs`) reads `bonk_ntr_1.lst` the same way.

## The payload needs a decoder this project does not have

The archive side is walkable, but every entry is a picture or a sound in a format the project reads no
further than the reference's own list of them.

- `DPNG` (`ArcFormats/Qlie/ImageDPNG.cs`) and `BIP` (`ArcFormats/Cri/ImageBIP.cs`) hand their entries to
  a PNG reader.
- `ARGB` (`ArcFormats/Qlie/ImageARGB.cs`) picks between `JpegBitmapDecoder` and `PngBitmapDecoder`, i.e.
  the Windows imaging stack.
- `CAB` (`Experimental/Cabinet/ArcCAB.cs`) hands every entry to a cabinet library.
- `AIFF` (`ArcFormats/AudioAIFF.cs`) and `WMA` (`ArcFormats/AudioWMA.cs`) hand theirs to NAudio.
- `OPUS` (`Experimental/Opus/AudioOPUS.cs`) and `PNG/ISM` (`ArcFormats/Ism/ImagePNG.cs`, whose entries
  open through an `ISA` archive) depend on external readers in the same way.
- `LAY/MAGES` (`ArcFormats/NitroPlus/ArcLAY.cs`) reads a companion PNG for every entry.
- `CRXD` (`ArcFormats/Circus/ImageCRXD.cs`) stands on the `CRX` reader of the same engine, which this
  project has not ported.
- `DZI` (`ArcFormats/Malie/ImageDZI.cs`) reads a directory of tiles whose data comes through `VFS`, i.e.
  through other files beside it, rather than from the picture.
- `GAL/X200` (`ArcFormats/LiveMaker/ImageGALX.cs`) describes its layers in an XML header (`ReadXml`),
  which would need an XML walk this project does not have. `GAL/X` (`ArcFormats/LiveMaker/ArcGALX.cs`)
  splits one such picture into its frames and layers, so it stands on the same walk and is not a
  candidate of its own.

## The payload is a .NET object graph

- `BYTES/UNITY` (`ArcFormats/Unity/ArcSpVM.cs`) reads its entries through `BinaryFormatter` with a binder
  that maps the game's `LinkerInfo` types onto its own. Deserializing that graph needs the game's own
  assemblies, and the format is a serialization of them rather than a byte layout.

## The picture is a palette kept beside the game

- `BIZ` (`Legacy/Adviz/ImageBIZ.cs`) and `GIZ/2` (`Legacy/Adviz/ImageGIZ2.cs`) read their palette out of
  the companion files `GRP_TBL.SYS` and `PLT_TBL.SYS`, addressed through a `GrpMap` table. The picture
  data itself is walkable; the palettes are the whole of the difficulty, and they are shared between the
  two formats.

## The picture lives inside an archive this project does not read

- `S5I` (`ArcFormats/rUGP/ImageS5I.cs`) reads one object of a `CRioArchive`, whose walk lives in the
  fifteen hundred line `ArcFormats/rUGP/ArcRIO.cs` and `LoadRio*` helpers that this project has not
  ported.

## The reference class is only a base for engines to build on

- `SCR` and `TXT` (`GameRes/ScriptText.cs`) are `abstract class ScriptFormat` and
  `abstract class GenericScriptFormat` with `TextScriptFormat` and `BinScriptFormat` beside them. They
  carry no layout of their own, because each engine subclasses them; registering them here would mean
  reading every file of those extensions as one unnamed script.

## Screened, with the reason for the delay recorded

These carry no key, no outside listing and no reader outside the reference tree in the places the
screening looked, and the reference is complete. What delays them is the size or the shape of the port
rather than a missing input, so each entry records what the port would have to carry. They are the first
candidates when porting continues.

- `PX` (`ArcFormats/Leaf/ImagePX.cs`, 488 lines) is a block structured picture reader with its own reader
  classes (`PxReader`, `PxBlock`).
- `PAD` (`ArcFormats/ShiinaRio/AudioPAD.cs`) decodes through a 69 entry `double` table (`PadDecoder`),
  which JavaScript floats can hold exactly as the reference uses them.
- `DCF` (`ArcFormats/AliceSoft/ImageDCF.cs`) reads a base picture and overlays whose base name comes from
  the AFA archive that holds them; the AFA archive is already ported (`ArcFormats/AliceSoft/ArcAFA.cs`).
- `RIO` (`ArcFormats/rUGP/ArcRIO.cs`, 1487 lines) is the object-manager archive that `S5I` needs, and the
  reason that picture stands unread.
- `EXE` (`Experimental/Microsoft/ArcEXE.cs`, 259 lines) is the PE sibling of the ported NE walker and
  would carry the resource walk of `ArcFormats/ExeFile.cs` (497 lines) with its `ResourceAccessor`, the
  resource directory tree and the RT_BITMAP wrapper that puts a bitmap file header in front of a stored
  bitmap. It also holds the version resource parser that works, unlike the NE one.
- `DIF/MnV` (`ArcFormats/MnoViolet/ImageDIF.cs`, 155 lines) is a difference against a base image: its
  header names that image without an extension and the reference finds it by globbing the directory
  (`VFS.GetFiles (base_name+".*")`) and decodes it with whichever format reads it. A port would need the
  companion lookup, which this project has, and then a way to hand the companion to another image
  format, which it does not have yet. The stored diff is two LZSS streams, one holding a pixel index and
  one the differences themselves.
- `EPA` (`ArcFormats/Pajamas/ImageEPA.cs`, 238 lines) carries two signatures and five colour types. Its
  reader walks a channel through a sixteen entry offset table, reads a colour map with `PaletteFormat.Bgr`
  for the one byte kinds, reads a second channel for its alpha colour type, and lays out pixels of more
  than one byte in separate planes. None of that is blocked; it is simply more than one sitting's work.

## Two engines can share a tag and a class name

The gap inventory identifies an implementation by its kind, tag, source file and class name, and two
unrelated engines can agree on all but the file. Two such pairs exist in the baseline:

- `YK`: `Legacy/Rune/ArcYK.cs` and `Legacy/Koei/ArcYK.cs` both export `YkOpener` for the tag `YK`, and the
  formats are unrelated — Rune's index sits inside the file, Koei's comes from a table keyed on the file
  name. Both are ported now, as `rune-yk` and `koei-yk`.
- `WEBP`: `ArcFormats/WebP/ImageWEBP.cs` and `Experimental/WebP/ImageWEBP.cs` both export `WebPFormat`.
  The first, ported as `webp-image`, parses the container and decodes through a managed `WebPDecoder`. The
  experimental variant parses the same container — its reading code is the managed one's — and differs
  only in decoding pixels through `libwebp.dll` and WPF, which has no place in a pure TypeScript port.
  Its entries are therefore covered by the ported format, and no separate record is kept.
