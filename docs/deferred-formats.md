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
- `WBC` (`ArcFormats/Primel/AudioWBC.cs`, 525 lines) stands of a **dump of a decompilation of the
  engine's own code**, kept as it came out of the decompiler rather than resolved. `DecodeChunk` stands of
  the places `v2` and `rate` (which stand nowhere in the file), of `field_C`, and of `a1->output` of an
  `a1` standing nowhere either; the class `WbcDecoder` holds no places of the file the walk of a chunk
  stands of (`this->field_4`, `this->field_1C[a3]`, `this->field_28[a3]` and the rest stand nowhere in it
  as well); and the walks `sub_582550` calls (`sub_58BFF0`, `sub_58C050`, `sub_58C120`, `sub_639810`) stand
  of no places of the file of the reference at all, as `sub_580CE0` and `sub_690850` do not. The file
  therefore does not compile, and there is no walk of the engine to stand of here: the audio of the engine
  would have to be worked out of the places of the engine itself, of no reference at all. What stands
  readable is the head of the picture of the engine (the places of the file of the head of it, the count of
  the chunks of it, the table of the places of the chunks and the kind of a chunk, of the four kinds
  `DwordTable` names); what stands of no reading is the walk of the places of a chunk of it.

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
- `ARC/FOMA` (`Legacy/StudioFoma/ArcARC.cs`, the `ARC/FOMA` opener) cannot read a file on its own at all:
  its index is not in the archive but in a **separate executable** that stands beside it, and where in that
  executable is a number the engine keeps **per archive name per executable name**. `Is9Scheme.KnownSchemes`
  ships as an empty dictionary, so `TryOpen` finds no scheme, and with no scheme it returns nothing for every
  file. The archive itself is then plain: twelve bytes an entry - a place, an offset and a size - with the
  name read from the executable at the place the entry names.
- `AVC` (`ArcFormats/ArcAVC.cs`, the extension-gated `DatOpener` of the `.dat` files of that engine) derives
  its own eight byte key from the file, so its reader looks self-contained - but it does so only once it is
  told **where** to look: `AdvReader.GetIndex` walks `KnownSchemes` and tries a key offset and a header
  offset from each, and `AdvReader.KnownSchemes` ships as `new ArchiveScheme[0]`. With no scheme it returns
  nothing for every file, so the reference reads no archive of this engine at all until a person supplies
  the two numbers. The eight bytes it checks are the header's own bytes exclusive-or'ed with `"ARCHIVE\0"`,
  each of which has to come out as a printable character.
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

- `PCK/TAMAMO` (`ArcFormats/Tamamo/ArcPCK.cs`, `PckScheme` at line 221): the archive opens with `PACK` and
  the mark `_FILE001`, but its **whole index** is decrypted with a key `QueryKey (file.Name)` looks up in
  `KnownKeys`, which the shipped `DefaultScheme` holds as `new Dictionary<string, byte[]>()`, and `TryOpen`
  gives up when there is no key (`if (null == key) return null`). A build without the runtime scheme a game
  was shipped with reads no archive of this engine at all - not even its listing. What a key would unlock is
  an index of two words an entry, every entry a **bzip2** stream behind it, which this project has no decoder
  for either. The keys stand in GARbro's `Formats.dat`, not in its source.
- `DAT/RepiPack` (`ArcFormats/Littlewitch/ArcDAT.cs`, `RepiScheme` at line 192): `Repi` followed by `Pack`,
  version five and nothing else, a length of the name at 0xC and a key of the name at 0x10. The key comes out
  of `FindKey (file.Name, name_key)`, which walks `KnownSchemes` - held as `new Dictionary<string, uint[]>()`
  and filled from the data file `littlewitch.lst` - and `TryOpen` gives up when it finds none
  (`if (null == key) return null`), which is the way it stands in the source. What it would unlock is the
  whole index, two words a record, decrypted with two words of the key; the names of the entries are folded
  from an MD5 of the lowercase name, and an entry may be encrypted again with a key built out of its own name.

- `LIBP` (`ArcFormats/Malie/ArcLIB.cs`, the `DatOpener` of the Malie engine; the plain `LIB` of the same file
  is ported as `malie-lib`) decrypts the first sixteen bytes of a file with every scheme it knows before it can
  tell whether the file is one of its own: it walks `KnownSchemes` and keeps the scheme whose decryptor turns
  the head into `LIBP` or `LIBU`. That table stands as `new Dictionary<string, LibScheme>()` in the source -
  a scheme carries the decryptor itself and where the index is aligned - so a stock build reads no encrypted
  archive of this engine at all. What a scheme would unlock is a directory of two words a record, whose entries
  stand at places counted in whole kilobytes, with the names of the directories themselves folded into the
  same records; every entry's payload is decrypted block by block as it is read.

- `PAZ` (`ArcFormats/Musica/ArcPAZ.cs`, `QueryEncryption` at line 299): the archive tells itself by one of
  eight long words, and then the key of its index and of every one of its entries comes out of
  `QueryEncryption (file.Name, signature)`, which walks `KnownSchemes` - a table that stands as
  `new Dictionary<uint, PazScheme>()` and is filled from a data file - and falls back on the names of the
  games it knows (`KnownTitles`, also empty). `TryOpen` gives up when it finds no scheme (`if (null == scheme)
  return null`), so a stock build reads no archive of this engine at all. The index of a scheme is unwrapped
  with a key of the scheme, entries are read through a common cipher and, behind it, a run of their own whose
  first bytes are stepped over as many times as a digest of the key of the entry names.
- `WAR` (`ArcFormats/ShiinaRio/ArcWARC.cs`, `QueryEncryption` at line 296): the archive opens with `WARC 1.`
  and a version, and its index stands at a place the head names as the complement of a word of its own. An
  archive of version beyond the eleventh asks `QueryEncryption (file.Name)` for a scheme - out of a table that
  stands empty in the source - and gives up without one (`if (null == scheme) return null`). The older
  archives read through a scheme of the source, but every entry of them is unwrapped by the `Decoder` of the
  same engine, whose index, names and entries are all read through it. (The older archive of the same engine,
  `WAR/1.0` of `ArcFormats/ShiinaRio/ArcWARC1.0.cs`, is ported as `shiina-rio-warc`.)
- `TCD3` (`ArcFormats/TopCat/ArcTCD3.cs`): the key of the archive is looked up in `KnownKeys`, held as
  `new Dictionary<string, int>()` in the source and filled from a data file, and every entry of the archive is
  unwrapped with it.
- `SERAPH/ARCH` (`ArcFormats/Seraphim/ArcSeraph.cs`): the archive stands at a place within a file that is named
  by a scheme - `KnownSchemes` holds `new Dictionary<string, ArchPacScheme>()` and the reader walks the places
  the schemes name in the order of their offsets. With no scheme it can tell no archive at all.
- `YPF` (`ArcFormats/YuRis/ArcYPF.cs`, `QueryEncryptionScheme` at line 192): the key of the index and of every
  entry comes out of a scheme the reader is asked for by the name of the file, out of a table held as
  `new Dictionary<string, YpfScheme>()` in the source; without one it reads nothing.
- `NSA` (`ArcFormats/NScripter/ArcNSA.cs`): the key that unwraps an entry is looked up in `KnownKeys`, held as
  `new Dictionary<string, string>()` in the source and filled from a data file, and the payloads of the
  archives of that engine are **bzip2** streams this project has no decoder for.

- `NPK` (`ArcFormats/NitroPlus/ArcNPK.cs`, class `NpkOpener`, signature `NPK2`): the whole index is
  **AES-CBC** encrypted under a key of the game of the archive. `TryOpen` asks `QueryEncryption` for it,
  which looks the file name up in `KnownKeys` - a dictionary the source ships **empty** - and gives up
  without a key (`if (null == key) return null`), so with no key the index cannot even be located: a
  stock build reads none of these archives. The payloads are raw deflate streams before that (`NpkStream`),
  which this project already reads, and an entry of a single uncompressed segment is a plain stream.

- `GAL` (`ArcFormats/LiveMaker/ImageGAL.cs`, class `GalFormat`, mark `Gale`): the head of the versions 100
  to 107 is plain - the version stands in the letters 4 to 6 - and the walk of the places stands on the
  file alone. What is not in the file is the **key of a shuffled picture**: `QueryKey` asks `KnownKeys`,
  which the shipped `DefaultScheme` keeps empty, and the reference's own setting, and hands the places of
  a picture over unshuffled under the key of nothing when neither of them stands (`if (!KnownKeys.Any())
  return 0;`). A port could read every picture that carries no shuffle bit and list all of them; the
  shuffled ones would stand of a key of nothing.

## The index is not in the archive

The names, sizes and order of the entries come from a listing that GARbro keeps beside the games rather
than inside the archive, so a game file alone cannot be walked.- `BIN/IDX` (`ArcFormats/Unity/ArcBIN.cs`) keys each archive with a **key and an initialisation vector of its
  own**, looked up by the archive's name in `BinPackScheme.KnownKeys` - a dictionary that ships **empty** -
  and its entries are keyed with the AES of that pair. With no key there is nothing to try, so a stock build
  reads no archive of this kind.
- `AIR` (`ArcFormats/AIRNovel/ArcAIR.cs`) reads its plain containers as **ordinary zips**, which this project
  already reads, and its keyed ones through RC4 with a passphrase that `KnownKeys` - an **empty** dictionary
  and a prompt - supplies at run time. A stock build therefore reads only the plain ones, which need nothing
  of this port.

- `DAT/IGS` (`Experimental/CellWorks/ArcDB.cs`) keeps its index in an **SQLite database** that stands beside
  the archive: the opener builds an `IgsDbReader` over the file and asks it for an archive id and then for the
  index. Sqlite is not a dependency of this project, and the archive itself carries no index of its own, so
  nothing can be read without one. (Its passwords are **not** the bar: `KnownPasswords` ships two of them.)
- `DAT/hibiki` (`ArcFormats/YaneSDK/ArcHibiki.cs`) takes its scheme from a **data file** the reference loads
  at run time (`DeserializeScheme`, off `FormatCatalog.Instance.DataDirectory`), not from anything in its own
  source, so there is no scheme here to port and nothing to compare a container against.

- `ARC/noncolor` (`ArcFormats/NonColor/ArcDAT.cs`) keeps three things outside the archive. The **scheme**:
  `QueryScheme` looks the archive's title up in `KnownSchemes`, which ships **empty**, and otherwise
  **prompts the user** through `ArcDatOptions`; with no scheme `TryOpen` returns `null`. The **names**:
  `ReadFilenameMap` reads `scheme.FileListName` out of GARbro's data directory, or `NCFileMap.dat` and the
  `.idx` beside it, because the archive itself carries CRC64 hashes alone. And through the names even the
  **entry table**: while `Flags & 2` stands clear the opener XORs the offset, the size and the unpacked size
  with three bytes of the *name* (`entry.Offset ^= Extend8Bit (raw_name[raw_name.Length >> 1])` and the two
  beside it), so the places of the file of such an entry cannot be found at all without the listing.

- `ALL/GIGA` (`Legacy/Giga/ArcALL.cs`) carries **no index at all**: `TryOpen` looks the archive's file
  name up in `FileMap273`, a table of entries written out **inside the reference's own source** (the file
  is 2090 lines, of which that table is nearly all), and returns `null` for anything else. Its walk of
  the places of the file of an entry (an LZSS of its own, `LzssUnpack`) is readable and portable, but
  no entry can be placed without the table that names it.

- `MBM` (`Legacy/Logg/ArcMBM.cs`) selects a listing by archive size (`0x0AB0F5F4` to `logg_pl.lst`,
  `0x0BFFD3DA` to `logg_ak.lst`, `0x09809196` to `logg_th.lst`).
- `PACK/BONK` (`ArcFormats/Bonk/ArcPACK.cs`) reads `bonk_ntr_1.lst` the same way.

- `DAT/WEAPON` (`Legacy/Weapon/ArcDAT.cs`, class `DatOpener`, no mark of its own): the archive carries no
  index at all. Its entries come out of `KnownFileTables`, a table of **274** hand written sizes keyed by
  the name of the file itself (`eventcg.dat` and its like), and the walk of a picture behind them is a
  plain sixteen bit one. A port would carry that table of sizes as it stands, the way the port of
  `ALL/GIGA` would carry the file map of that engine.

## The payload needs a decoder this project does not have

The archive side is walkable, but every entry is a picture or a sound in a format the project reads no
further than the reference's own list of them.

- `ARGB` (`ArcFormats/Qlie/ImageARGB.cs`, 114 lines) stands of a head of `ARGBSaveData1` and the kind 3 in
  it, the count of a **JPEG** at the seventeenth place of the head and the count of a **PNG** mask behind
  it, which it joins into a picture of the places of the JPEG and the grey places of the mask. The walk of
  the places of a PNG stands in hand (`shared/png-image.ts`), so what stands of this row is the walk of the
  places of a **JPEG**: the project holds the head fields of one (`shared/jpeg.ts`) and no decoder, and
  `gameres-jpeg-image` hands a graphic of that kind over as it stands rather than reading its places. The
  port of `BIP` (`ArcFormats/Cri/ImageBIP.cs`) is `cri-bip-image`, and `qlie-dpng-image` is the port of the
  tiled picture of the same engine.
- `CAB` (`Experimental/Cabinet/ArcCAB.cs`) hands every entry to a cabinet library.
- `AIFF` (`ArcFormats/AudioAIFF.cs`) and `WMA` (`ArcFormats/AudioWMA.cs`) hand theirs to NAudio.
- `OPUS` (`Experimental/Opus/AudioOPUS.cs`) and `PNG/ISM` (`ArcFormats/Ism/ImagePNG.cs`, whose entries
  open through an `ISA` archive) depend on external readers in the same way.
- `LAY/MAGES` (`ArcFormats/NitroPlus/ArcLAY.cs`) reads a companion PNG for every entry.

- `UNITY/FS` (`ArcFormats/Unity/ArcUnityFS.cs`, class `UnityFSOpener`) needs two decoders this project does
  not carry: the index of the container is an **LZMA** stream where its flags say so (`UnpackLzma`), and
  every entry behind the index is an **LZ4** block (`Lz4Compressor.DecompressBlock`).
- `CRXD` (`ArcFormats/Circus/ImageCRXD.cs`, class `CrxdFormat`, which stands on the `CrxFormat` of the same
  engine, now ported as `circus-crx-image`) is a **differential** picture: its head names the picture it
  stands on by name and by offset in the archive the picture came from (`BaseOffset` at 8, `BaseFileName` as
  a string at 0xc), and the difference stands either behind the head (the word `CRXG` at 0x20) or at an
  offset of that same archive (the word `CRXJ` at 0x20, the offset as a word behind it). Both the base and
  the difference are read through the engine's own file system -
  `VFS.Top as ArchiveFileSystem` and `arc.Source as CrmArchive`, `arc.OpenByOffset (offset)` - so the picture
  cannot be read from the file it stands in alone: the port would hand over the difference where the picture
  stands of the base and the difference together.
- `DZI` (`ArcFormats/Malie/ImageDZI.cs`) reads a directory of tiles whose data comes through `VFS`, i.e.
  through other files beside it, rather than from the picture.
- `GAL/X200` (`ArcFormats/LiveMaker/ImageGALX.cs`) describes its layers in an XML header (`ReadXml`),
  which would need an XML walk this project does not have. `GAL/X` (`ArcFormats/LiveMaker/ArcGALX.cs`)
  splits one such picture into its frames and layers, so it stands on the same walk and is not a
  candidate of its own.

- `WEBP` (`Experimental/WebP/ImageWEBP.cs`, a second `WebPFormat` beside the one this project ports from
  `ArcFormats/WebP/ImageWEBP.cs`) keeps the same tag and the same class name and decodes nothing itself: it
  reads the whole file and hands the bytes to `libwebp.dll` through `WebPDecodeBGRAInto`, which it loads with
  `LoadLibraryEx`. A port would have to carry a WebP decoder of its own, which is what the other file beside
  it does - and what this project reads.

## The payload is a .NET object graph

- `BYTES/UNITY` (`ArcFormats/Unity/ArcSpVM.cs`) reads its entries through `BinaryFormatter` with a binder
  that maps the game's `LinkerInfo` types onto its own. Deserializing that graph needs the game's own
  assemblies, and the format is a serialization of them rather than a byte layout.

- `DAT/GX4LIB` (`ArcFormats/Unity/Gx4Lib/ArcDAT.cs`, class `DatOpener`, no mark): the index of the archive
  is a **.NET object graph** of the reference's own serialization (`GameRes.Gx4Lib.PackageFile.Deserialize`
  reads an index of `PFAudioHeaders` or of `PFImageHeaders`), the entries behind it are packed with
  **QLZ** (`QlzUnpack`), a decoder this project does not carry, and their pictures stand of the Gx4
  decoders and of a table of visual differences the reference keeps beside it. Three things outside the
  file stand between it and a port.

## The picture is a palette kept beside the game

- `BIZ` (`Legacy/Adviz/ImageBIZ.cs`) and `GIZ/2` (`Legacy/Adviz/ImageGIZ2.cs`) read their palette out of
  the companion files `GRP_TBL.SYS` and `PLT_TBL.SYS`, addressed through a `GrpMap` table. The picture
  data itself is walkable; the palettes are the whole of the difficulty, and they are shared between the
  two formats.

## The picture lives inside an archive this project does not read

- `S5I` (`ArcFormats/rUGP/ImageS5I.cs`) reads one object of a `CRioArchive`, whose walk lives in the
  fifteen hundred line `ArcFormats/rUGP/ArcRIO.cs` and `LoadRio*` helpers that this project has not
  ported.

- `RIP` (`ArcFormats/rUGP/ImageRIP.cs`, class `RipFormat`, extensions `rip` and `sia`) is the picture of the
  same engine and stands in the same place as `S5I`: its own signature is nothing, because `ReadMetaData`
  first asks whether the file carries `CRioArchive.ObjectSignature` and then builds a `CRioArchive` to read
  a `CRip` or `CRip007` object out of it. Without the `RIO` walk there is no object to read at all, so this
  one stands behind that port rather than behind a decoder of its own.
- `PSB/EMOTE` (`ArcFormats/Emote/ArcPSB.cs`, 878 lines, tag `PSB/EMOTE`) is **portable in principle** - the
  reference ships a real key (`KnownKeys = new uint[] { 970396437u }`) and falls back on a plain parse, so a
  stock build does open these containers - but a first port of it stands withdrawn. The container is a
  serialised object graph: a head naming six tables, a **name trie** whose nodes reach their children by a
  base of their own, arrays whose count field is itself an object of the file (which is what the array's own
  header size is read from), and dictionaries whose values hold places counted from the end of their own
  arrays. The head, the key schedule and the table checks were written and are understood; the trie walk came
  back with an **empty name map** on a hand built container, and every dictionary lookup stands on it, so the
  reader was withdrawn rather than landed unverified. A second pass wants a **real** container to step
  through, or a mirror writer for the trie built alongside the reader, since the walk's own condition
  (`i >= nm1.Count || nm2[i] != prev`) is subtle enough that a synthetic fixture alone did not pin it.
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
- `SCW` (`ArcFormats/GsPack/ArcGsPack.cs`, `GsScriptFormat`) and `DAT/GENERIC`
  (`ArcFormats/ArcCommon.cs`, `DataFileFormat`) stand on `GenericScriptFormat` as well and carry no walk
  of the file of their own: the classes stand of the walk of the engine of the scripts of the reference,
  of the marks `SCW `, `Scw5` and `Scw4` of the first of them and of no mark of the second of them (of
  the description "Unidentified data file" of it). The archives of the GsPack engine stand in this project
  as `gspack`; the scripts of it stand of no walk of them here.

- `AMP/LEAF` (`ArcFormats/Leaf/ArcPAK.cs`, class `AmpFormat`) stands on `GenericScriptFormat` as well and
  carries no walk of a file at all: the class holds a tag, a description, a mark of nothing and, beside it,
  a single alias of the extension `SDT` to the scripts of the engine. There is no reading algorithm in it
  to port.

- `TIFF` (`GameRes/ImageTIFF.cs`, `TifFormat`) parses its own tags - the class `Parser` walks the image
  file directory of the file, its types and its counts - and then **hands the pixels to WPF**:
  `Read` stands of `TiffBitmapDecoder` and `Write` of `TiffBitmapEncoder`, of no walk of the places of the
  picture of the reference at all. A port would have to write the walk of the places of a picture of the
  marks of the file (of the counts of the places of a colour of one, of four, of eight, of sixteen, of
  twenty four and of thirty two of them, of the walks of the places of the file of its own, of the packs
  of the places of the file of it and of the deflate walk of it) with no walk of the reference to stand of
  it, so the file stands of no port of it here.

## Screened, with the reason for the delay recorded

These carry no key, no outside listing and no reader outside the reference tree: the screening looked, and
the reference is complete. What delays them is the size or the shape of the port rather than a missing
input, so each entry records what the port would have to carry. They are the first candidates when porting
continues, and an entry leaves this section once the port lands: what remains of a ported format stands in
`docs/support-status.json` rather than here.

The survey that fills this section reads the gap inventory through
`node scripts/garbro-gap.mjs --all --json`. The text form lists the rows that are only partly ported
beside the ones nothing has been written for yet, so the queue of untouched rows comes from the `pending`
list of the `--json` form, which holds exactly the not-started rows. Without `--all` both forms stop at
the first forty of them.

- `DCF` (`ArcFormats/AliceSoft/ImageDCF.cs`) reads a base picture and overlays whose base name comes from
  the AFA archive that holds them; the AFA archive is already ported (`ArcFormats/AliceSoft/ArcAFA.cs`).
- `RIO` (`ArcFormats/rUGP/ArcRIO.cs`, 1487 lines) is the object-manager archive that `S5I` needs, and the
  reason that picture stands unread.
- `EXE` (`Experimental/Microsoft/ArcEXE.cs`) is **not portable**: it reads an executable's resources through the reference's `ExeFile.ResourceAccessor`, which is a set of Windows loader calls (`LoadLibraryEx`, `FreeLibrary`, `FindResource`, `LoadResource`, `SizeofResource` and the enumeration callbacks behind them) rather than anything read out of the file. The managed half of the same file - the headers, the sections, the overlay, the loaded base, addresses and a byte search - **is** portable and now stands in this project as `packages/formats/src/microsoft/exe-file.ts`, which is what the ported `BIN/PAC` archive and, later, any other reader of an executable needs.
- The **base picture of a difference** is the one place the reference hands a file to another format of
  its own outside an archive: `DIF/MnV` (`ArcFormats/MnoViolet/ImageDIF.cs`) names its base beside itself
  and the reference reads it with whichever format of its registry takes it. That port is
  `mnoviolet-dif-image`, and its base stands of a bitmap or of a portable network graphic, the two kinds a
  format of this project can read out of a file on its own; a registry to reach the rest of them stands at
  the front of this project rather than within a format, and no other row of this list stands of it.
- `ARC/Tactics/2` (`ArcFormats/Tactics/ArcTactics.cs`, `Arc2Opener`) reads a flat list of pictures at
  `0x10` (the count of the places of a picture, the count of them as they stand, the count of the places of
  its name, then the name and the places of the picture) and then **refuses the picture itself**:
  `TryOpen` stands of `QueryScheme()`, which the reference fills from its format database
  (`SchemeMap`/`KnownSchemes`, keyed on the title) or from `Properties.Settings.Default.TacticsArcPassword`,
  and neither stands in the reference tree. Every picture of it stands of the places of the file `^` the
  places of that password and of the engine's own LZ walk behind them (`UnpackCustomLzss`), so a headless
  port could list the pictures of a file and never read one of them. The walk of the pictures of the plain
  `ArcOpener` (`ARC/Tactics`) **is** ported, as `tactics-arc`; the custom LZ walk would be a staged port of
  the kind TLG6 and JBP took, and would still stand of no picture to check it against without the password.
- `PCF` (`ArcFormats/Primel/ArcPCF.cs`, 259 lines) is a Primel archive whose index and entries are
  transformed by one of two schemes the reference tries in turn. It stands of `Primel.SHA256`, which is now
  ported as `packages/codecs/src/primel-sha256.ts` - a copy of the walk **whose round is not the one of the
  standard**, which that file writes out - and of the three `Primel1/2/3Encyption` ciphers
  (`Encryption.cs`, 510 lines), `GameRes.Cryptography.RC6` (`RC6.cs`, 155 lines), AES in CFB mode with zero
  padding, and the `Range`, `Rle`, `Mtf` and `Lzss` packed streams the flags select between
  (`Compression.cs`, 357 lines). That is a staged port of the kind TLG6 and JBP took, not a single one, and
  its first stage has landed.

- `LAY/MAGES` (`ArcFormats/NitroPlus/ArcLAY.cs`, class `LayOpener`, extension gated on `.lay`): the index
  of the engine is plain - a count of the layers, a count of the tile coordinates, then a record per layer
  (a word of its own, a first and a count) and a run of four words per coordinate - and the tiles are
  crops of a **sibling PNG** whose name is the base name of the archive (the reference finds it through
  `VFS`, so it may sit inside another archive). The composite is then drawn with **WPF**: a
  `DrawingVisual`, thirty two by thirty two `CroppedBitmap` crops and a `RenderTargetBitmap` of 1920 by
  1080. A port would need a PNG decoder, which this project does not carry yet (it writes PNGs through
  `shared/png-image.ts` but reads only the head fields), and a source-over compositor in place of the WPF
  drawing. The index of the format could be listed without either.


- `IMG` (`ArcFormats/ScrPlayer/ImageIMG.cs`, class `ImgFormat`) and `IMG2` (`ArcFormats/ScrPlayer/ImageI.cs`,
  class `Img2Format`) are the pictures of the ScrPlayer engine. Neither stands on anything outside the
  reference tree, but each walks its places through a table of its own that ships beside it: the first
  reads `ImgControlTable1`, `ImgControlTable2`, `ImgControlTable32` and `ImgDeltaTable2`, and the second
  reads `IControlTable1`, `IControlTable2`, `IControlTable32`, `IColorBitsTable1` and `IColorBitsTable2`.
  Those nine files are some thirty six kilobytes of tables, which a port extracts the way this project
  extracted the tables of the HyperWorks and Nekotaro pictures; what stands between them and a port is the
  size of the two readers together rather than a missing input.
- `MIO` (`ArcFormats/Entis/AudioMIO.cs`, class `MioAudio`, 362 lines) is portable on its own: its
  `ERISADecodeContext` stands in the same file, and its sound input stands on `MioDecoder` of
  `ArcFormats/Entis/MioDecoder.cs`, 968 lines of arithmetic. Nothing outside the Entis tree is needed, so
  the unit is that pair rather than a missing input.
- `CPZ` (`ArcFormats/Cmvs/ArcCPZ.cs`, class `CpzOpener`, the layouts whose mark reads `CPZ5`, `CPZ6` or
  `CPZ7`) is the newer archive of the CVNS engine, and its unit is four files rather than one: the opener
  itself (776 lines), the head (`CpzHeader.cs`, 175), the walk of its entries (`Cpz5Decoder` and
  `ArchiveKey`, in the opener), a Huffman reader of its own (`HuffmanDecoder.cs`, 108) and a **custom MD5**
  (`CmvsMD5.cs`, 194) whose state feeds the keys of every step. Every index is encrypted end to end: the
  head is checked against an MD5 of its own, the seventh layout unpacks its index key through the Huffman
  reader, and the index itself then goes through a mix over a twenty four word secret, the walk of the
  `Cpz5Decoder` (twice), a directory walk and an entry walk. None of that needs an input this project does
  not have - the `ArchiveKey` of the newer versions comes from a key file that a stock build replaces with
  zeros - so what holds the port back is the **fixture**: every one of those steps is a decoder, so a
  fixture index has to be written *through* them, and while the mixes and the dword walks are invertible,
  the inverse of the `Cpz5Decoder` is a compressor this project would have to write first. That is a
  bigger piece of work than the port itself, which is why the two older archives of the same engine
  (`cmvs-cpz1` and `cmvs-cpz2`) are ported and this one is not.
- `DXR` (`ArcFormats/Macromedia/ArcDXR.cs`, class `DxrOpener`) is a Macromedia Director presentation, and
  its unit is `DirectorFile.cs` (836 lines) beside the opener (504): the reader of the `RIFX`/`XFIR` chunk
  tree, a `mmap` index and the `KEY*`/`CAS*` resources, all of it written through a **table driven
  deserializer** (`SerializationContext`, `DirectorFile`, `DirectorEntry` and a `Reader` of its own). The
  archive side then lists the chunks the reference calls raw (`RTE0`, `FXmp`, `VWFI`, `VWSC`, `Lscr`,
  `STXT`, `XMED`, `File`), and the pictures and sounds of the engine need their palette and alpha
  resources. A fixture needs a writer for that serialised shape - the same shape the port's own reader
  would have to produce - so this one is a staged port of the kind TLG6 and JBP took rather than a single
  file.
- `HCA` (`ArcFormats/Cri/AudioHCA.cs`, class `HcaAudio`, 1213 lines) is the audio of the Cri engine and is
  the same shape on a larger scale: a big endian container, a table of scale factors built from a type of
  the head (`AthTable`), a cipher of the head's own type (`Cipher`, with the key of the game), a Huffman
  walk and the sample packers the sound input hands over. It is self contained - every one of those classes
  stands in the same file - but the whole of it is a codec whose places can only be pinned by a mirror of
  its own arithmetic, so it is a staged port too, and a longer one than `PCM`.
- `NOA` (`ArcFormats/Entis/ArcNOA.cs`, class `NoaOpener`, 616 lines) is the archive of the same engine. Its
  index and its own `ERISADecodeContext` are portable, but every entry it lists is an `ERI`, `EMI`, `MIO`,
  `EMS` or `TXT` file of that engine, so listing an archive of it without the whole Entis stack
  (`EriReader.cs` of 2844 lines, `MioDecoder.cs` of 968, `ErisaMatrix.cs` of 488, `ErisaNemesis.cs` of 338)
  names files that cannot be read. It is the last port of that engine.

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
