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
- `DPK` (`ArcFormats/Dac/ArcDPK.cs`) decrypts its own index with a chained XOR seeded by the last byte
  of the header, so its listing reads without a key, but every entry is then XORed with a pair of words
  that comes from `Properties.Settings.Default.DPKKey1` and `DPKKey2`, and the name hash the entry
  decryption subtracts is folded from the same pair. `KnownSchemes` ships as an empty array, so a payload
  cannot be read without the numbers the game was built with.
- `ASSETS/UNITY` (`ArcFormats/Unity/ArcASSET.cs`) reads a `Key` of the same kind.
- `OGG/TINK` (`ArcFormats/Cyberworks/AudioTINK.cs`) holds `TinkAudioScheme.KnownKeys` as an empty
  dictionary in the shipped default.
- `PAK/MORNING` (`ArcFormats/Morning/ArcPAK.cs`) reads `DefaultKey`.
- `DXA` (`ArcFormats/DxLib/ArcDX.cs`) ships both `DefaultScheme` and `KnownKeys` empty and asks for the
  key through `WidgetSCR.xaml`, i.e. through the person reading the file. Its sibling `BIN/DXLIB`
  (`ArcFormats/DxLib/ArcDX8.cs`) is worse off: its own `TryOpen` decrypts the index with a default key and
  then stops on `// decrypt-2` and `// decompress` and returns nothing, so the reference reads no such file
  at all.
- `PP/ILLUSION` (`ArcFormats/Illusion/ArcPP.cs`) keys its index with two hard-coded eight byte keys, so a
  listing would read without any input, but `QueryEncryptionScheme` asks the game catalogue for a title and
  then looks that title up in `PpScheme.KnownKeys`, which ships as an empty dictionary: a stock build
  returns nothing from `TryOpen` for every file of this engine. Its entries would need the scheme as well,
  and the fourth method it names (`UnpackData`) is a stub that hands the bytes back as they stand.
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
- `DREF` (`ArcFormats/Emote/ImageDREF.cs`) is not a picture at all: it is a little endian text file of
  `psb://<archive>/<entry>` lines, and the reference composes it by opening each named archive with the
  `PSB/EMOTE` opener, finding the entry by name, and drawing the layers one over another with WPF. It
  stands on three things this project does not have in that shape - the `PSB/EMOTE` archive, which is not
  ported, lookups by name through the virtual file system, and WPF layer blending - so even its metadata
  needs the archive.

## The reference class is only a base for engines to build on

- `SCR` and `TXT` (`GameRes/ScriptText.cs`) are `abstract class ScriptFormat` and
  `abstract class GenericScriptFormat` with `TextScriptFormat` and `BinScriptFormat` beside them. They
  carry no layout of their own, because each engine subclasses them; registering them here would mean
  reading every file of those extensions as one unnamed script.

## Screened, with the reason for the delay recorded

These carry no key, no outside listing and no reader outside the reference tree: the screening looked, and
the reference is complete. What delays them is the size or the shape of the port rather than a missing
input, so each entry records what the port would have to carry. They are the first candidates when porting
continues.

The survey that fills this section reads the gap inventory through `node scripts/garbro-gap.mjs --all`:
without `--all` the tool prints only the first forty pending rows, which is a shorter list than it looks
like.

- `PX` (`ArcFormats/Leaf/ImagePX.cs`, 488 lines) is a block structured picture reader with its own reader
  classes (`PxReader`, `PxBlock`).
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


- `WBM` (`ArcFormats/WildBug/ImageWBM.cs`, 1165 lines) is the picture beside the **ported** `WWA` sound, and
  most of it is ported now: the shared head and record walk (`wildbug/wpx-section.ts`), the picture's own
  head, the pixels, the colours of the eight bit kind, the alpha channel and the one way of storing a section
  the reference also reads as it stands, and the packed walks of the ways **`0x00` to `0x03` and `0x08`,
  `0x09`** as well. What remains is the **four further packed walks** of the `WbmReader` - `UnpackV4`,
  `UnpackV5`, `UnpackVB` and `UnpackVD` - for the section ways `0x04`, `0x05`, `0x0B` and `0x0D` upwards.
  Each builds a reference table of
  sixty four thousand entries (`BuildTable`, `FillRefTable`) and then walks the picture through a padded
  table of eight pixel offsets (`GenerateOffsetTableV1` or `V2`), retrying with the other table when a walk
  fails. All of that code is decompiler output in the reference (`sub_40919C`, `sub_46C26C`), so a port has
  nothing to check its own transcription against but the reference itself; the port refuses such a section by
  name rather than guessing. That is the first piece of staged work here, and it is one walk at a time.

- `GRP/RG` (`Legacy/Bom/ImageGRP.cs`, 418 lines) is a BOM picture whose header and stored pictures are
  plain, but whose packed pictures are an LZ of its own: a sliding frame of four thousand bytes filled
  with spaces, a run length and a distance, and both of those read through two **adaptive Huffman trees**
  whose weights and links are rebuilt for every symbol. The file holds the trees as machine generated
  code (`dword_6FF464`, `dword_703E68`, `dword_70986C`, `sub_408C80`), so a port would have to reproduce
  the updates exactly and has nothing to check them against but the reference itself. That is a staged
  port of the kind the TLG6 and JBP codecs took.
- `PCF` (`ArcFormats/Primel/ArcPCF.cs`, 259 lines) is a Primel archive whose index and entries are whose index and entries are
  transformed by one of two schemes the reference tries in turn. It would have to carry `Primel.SHA256`,
  the three `Primel1/2/3Encyption` ciphers, `GameRes.Cryptography.RC6`, AES in CFB mode with zero
  padding, and the `Range`, `Rle`, `Mtf` and `Lzss` packed streams the flags select between. That is a
  staged port of the kind TLG6 and JBP took, not a single one.
- `PB2` (`ArcFormats/Cmvs/ImagePB2.cs`, 265 lines) is the CVNS picture format whose header is encrypted
  with a twenty seven byte key stored at the end of the file, and it unpacks in four different ways: a
  block shuffled plane, a per channel block map, the JBP form, and four XORed channels. It stands on the
  shared `PbReaderBase` of `ImagePB.cs`, whose LZSS and JBP walks this project already carries for PB3,
  so the remaining work is the four variants and the header.

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
