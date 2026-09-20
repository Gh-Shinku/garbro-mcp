# Formats this project does not read, and why

This file keeps the reason every GARbro engine the project does not read yet stands unread, so that the
screening is not carried out again for every one of them. Every entry names the reference the screening stands
on. `docs/support-status.json` keeps what every format the project *does* read stands for; this file keeps the
other side of that line.

The reasons stand in groups.

## The reference stands incomplete

The reference itself hands nothing over, so there is no algorithm to stand beside.

- `MCP` (`Legacy/Mink/ImageMCP.cs`) and `LPC` (`ArcFormats/Hypatia/ArcLPC.cs`) do not compile.
- `AF2` (`ArcFormats/CsWare/AudioAF2.cs`) ends its reader at `format.SetBPS()` without standing anything over.
- `BIN/DXLIB` (`ArcFormats/DxLib/ArcDX8.cs`) ends its reader at `return null;` with `// decrypt-2` and
  `// decompress` still standing as words rather than as places.

## The keys stand outside the reference

The reference reads the keys of such a format out of its own tables, which stand empty, or out of the places of
the game, which stand outside the file of the archive.

- `ACV` (`ArcFormats/NonColor/ArcACV.cs`) and `DAT/MINATO` (`ArcFormats/NonColor/ArcMinato.cs`) read
  `QueryScheme`, whose `KnownSchemes` stand as no keys.
- `PKZ` (`ArcFormats/Sviu/ArcPKZ.cs`), `PKG/2` (`ArcFormats/Yatagarasu/ArcPKG2.cs`),
  `ASSETS/UNITY` (`ArcFormats/Unity/ArcASSET.cs`), `CG/ACTGS` and `CG/ACTGS/2` (`ArcFormats/Actgs/ArcCG.cs`),
  and `ADS` (`ArcFormats/BlackRainbow/ArcADS.cs`) stand the same way.
- `PBZ` (`ArcFormats/Cmvs/ArcPBZ.cs`), `ARC/FOMA` (`Legacy/StudioFoma/ArcARC.cs`), and
  `ARC/AI5WIN` (`ArcFormats/elf/ArcAi5Win.cs`) stand behind schemes of the same kind.
- `GPK/STACK` (`ArcFormats/Stack/ArcGPK.cs`) reads its key out of a file above the archive.
- `BIN/PAC` (`ArcFormats/DigitalWorks/ArcBIN.cs`) finds its index in the places of the game's own `.exe`.
- `PAK/MORNING` (`ArcFormats/Morning/ArcPAK.cs`) reads `MorningScheme.DefaultKey`, which stands as no key at
  all; `OGG/TINK` (`ArcFormats/Cyberworks/AudioTINK.cs`) stands the same way.
- `MBM` (`Legacy/Logg/ArcMBM.cs`) and `PACK/BONK` (`ArcFormats/Bonk/ArcPACK.cs`) read lists of files that
  stand outside the project.

## The places stand as another kind of file this project does not read

Reading the places of such a format means reading a second kind of file first, and that kind stands unread.

- `DPNG` (`ArcFormats/Qlie/ImageDPNG.cs`) stands as places of portable network graphics, one to a place, and
  `ARGB` (`ArcFormats/Qlie/ImageARGB.cs`) as places of such a picture and of a picture of the JPEG kind.
- `BIP` (`ArcFormats/Cri/ImageBIP.cs`) stands the same way, one picture to a place of the picture.
- `PNG/ISM` (`ArcFormats/Ism/ImagePNG.cs`) reads places of such a picture, and only where the file stands
  inside an archive of the `ISA` kind.
- `BMP/uGOS` (`ArcFormats/uGOS/ImageBMP.cs`) stands as a walk of the places of a picture of four and fifty
  places of its own, read through tables it stands as places of its own.
- `JBP` (`ArcFormats/Sviu/ImageJBP.cs`) hands its places to a reader of the kind of pictures of `PB3`, which
  stands in `ArcFormats/Cmvs/ImagePB3.cs`, a file of nine hundred places that keeps two formats of its own
  beside it. Its places stand in `PbReaderBase` (at line 88), `Pb3Reader` (193, with walks of its own at 229,
  323 and 376 and companions of the places of the game), and `JbpReader` (at line 470, with the places of its
  walk at 487, `Unpack` at 530, `Decode` at 572, `Dct` at 651 and `Ycc2Rgb` at 749). The words of a picture of
  that kind stand as this: where its places stand at the four places behind their own head, its kind at eight,
  how wide and how tall it stands at `0x10` and `0x12`, and how many places of two walks of the picture stand
  at `0x1C` and `0x20`; the places of a picture stand in places of eight, sixteen or two and thirty places of
  the picture by the high places of the kind of the file. `JbpReader.Unpack` stands two Huffman walks of the
  places of the picture, the places of both of which stand at the places the head names, the words of the walk
  standing at the eighty places behind those with one place added to every one of them, and the places that
  name how many places of the walk stand at the places themselves and at the sixty four places behind them; it
  then reads the places that name how many places of the picture every place of the walk stands for at the
  eighty places behind the words of the walks where the high places of the kind of the file name them, and
  reads the two walks themselves from the places behind those.
- The walks of such a picture stand as a kind of their own: the project's `packages/codecs/src/huffman.ts`
  stands a walk of another kind — its `decompressHuffman` reads places through a table of `HUFFMAN_TREE_SIZE`
  places — so reading `JbpReader` stands as a turn of its own rather than as a part of this one, and the places
  of its walks stand as the turn to begin with.

## The reference hands the work to a library or to the places of the game

- `CAB` (`Experimental/Cabinet/ArcCAB.cs`) hands every place to a library of the kind of cabinet files.
- `AIFF` (`ArcFormats/AudioAIFF.cs`) hands every place to the reader of the kind of sound files it stands as.
- `OPUS` (`Experimental/Opus/AudioOPUS.cs`) stands behind a library of the kind of sound it reads.
- `WMA` (`ArcFormats/AudioWMA.cs`) stands behind the places of the kind of files of the system.
- `S5I` (`ArcFormats/rUGP/ImageS5I.cs`) reads the places of a picture out of the kind of archives of the
  engine, which stand in fourteen hundred places of their own.
- `EXE/NE` (`Experimental/Microsoft/ArcNE.cs`) reads the places of a kind of files of the system.
- `BYTES/UNITY` (`ArcFormats/Unity/ArcSpVM.cs`) stands behind a reader of the kind of files of the system and
  companions of the places of the game.
- `LAY/MAGES` (`ArcFormats/NitroPlus/ArcLAY.cs`) reads a companion picture of the portable network graphic kind
  and stands its places into one picture through the places of the system.

## The head stands as words of another kind

- `GAL/X` (`ArcFormats/LiveMaker/ArcGALX.cs`) and `GAL/X200` (`ArcFormats/LiveMaker/ImageGALX.cs`) name their
  places through words of the kind of files that name places.
- `SCR` and `TXT` (`GameRes/ScriptText.cs`) stand as words of no places at all, so a port of them would tell
  every file of their kinds as a script of the engine.

## The places stand as a picture of their own

These stand as formats of their own rather than as parts of another, and every one of them reads the places of
a picture through tables it stands itself.

- `ImagePX.cs` (seventeen thousand places), `ImagePB3.cs` (nine hundred places), and
  `AudioPAD.cs` (`ArcFormats/ShiinaRio/AudioPAD.cs`) stand as the largest such places.
- `CRXD` (`ArcFormats/Circus/ImageCRXD.cs`) stands on a reader of the kind of pictures of `CRX`, which the
  project does not read.
- `DIF/MnV` (`ArcFormats/MnoViolet/ImageDIF.cs`) stands on the places of a companion picture and on the
  differences between the places of two pictures.
- `DZI` (`ArcFormats/Malie/ImageDZI.cs`) reads a directory of places of pictures of its own.

## The head of the file stands as the words of a picture of its own, and the project reads no such places

`WEBP` (`ArcFormats/WebP/ImageWEBP.cs`) reads the words of every kind of its own head and hands the places of
the picture to the reader of the kind of files of the system. Its words stand as a format of their own for a
turn of its own.

## The smallest entries, audited one by one

The entries that the support report names by the fewest bytes are not the smallest jobs: the byte count is the
size of the tag listing, not of the reader. Read against the reference, most of them stand on something this
project cannot supply. Each finding below is the reason the entry stays unread, with the places it stands in.

- **CRZ** (`ArcFormats/Crowd/ImageCRZ.cs`) — the picture is an `SZDD` stream, which this project can walk
  (`inflateLzss` with a frame of `0x1000` filled with `0x20` from `0x1000 - 0x10`), and the head behind it is
  a place of the words of a game encrypted with a key of thirty-six places. The reference draws that key from
  `CrzScheme.KnownKeys`, and its `DefaultScheme` stands as an empty dictionary (`ImageCRZ.cs`, the default
  scheme and the `KnownKeys` property), so the keys stand in the words of the game and nowhere in the
  reference. A picture of this kind therefore stands unread until a game's keys stand to hand.
- **MBM** (`Legacy/Logg/ArcMBM.cs`) — a place of the pictures of the engine without an index of its own: the
  reference names the list of the places of an archive by the size of the archive, through a table of three
  archives (`ArcSizeToFileListMap`: `0x0AB0F5F4` to `logg_pl.lst`, `0x0BFFD3DA` to `logg_ak.lst`,
  `0x09809196` to `logg_th.lst`), and reads the list through the file lists of the reference itself. Those
  lists stand beside the games rather than within the reference, so no archive can be read without one of
  them.
- **PACK/BONK** (`ArcFormats/Bonk/ArcPACK.cs`) — the same shape: the name, the size and the index of every
  place stand in `bonk_ntr_1.lst`, read through the file lists of the reference and standing beside the game
  rather than within the reference. The places of a picture of this kind are `SLID` streams that this project
  can walk, so only the index of an archive stands unread.
- **ADS** (`ArcFormats/BlackRainbow/ArcADS.cs`), **PKZ** (`ArcFormats/Sviu/ArcPKZ.cs`), **ARC/FOMA**
  (`Legacy/StudioFoma/ArcARC.cs`), **ACV** (`ArcFormats/NonColor/ArcACV.cs`) and **DAT/MINATO**
  (`ArcFormats/NonColor/ArcMinato.cs`) — every one of them draws its scheme from the game it stands beside:
  a list of keys, of names, or of the places of the places of the archive, through `Scheme` or
  `QueryScheme`, with a default that stands empty.
- **MCP** (`Legacy/Mink/ImageMCP.cs`) — the reference does not stand as it stands: `ReadMetaData` breaks off
  within the words of the head of the picture, and the walk of it names a kind of head, a kind of the places
  of a picture and the places of the picture itself that stand nowhere in the file. There is no algorithm to
  port.
- **S5I** (`ArcFormats/rUGP/ImageS5I.cs`) — the picture of the engine stands within an archive of the kind
  `CRioArchive` (the class `CRioArchive`, `LoadRioTypeCore`), which stands in the fifteen-hundred-line
  `ArcFormats/rUGP/ArcRIO.cs` and is not ported. The picture is one object within it.
- **BIZ** (`Legacy/Adviz/ImageBIZ.cs`) and **GIZ/2** (`Legacy/Adviz/ImageGIZ2.cs`) — both stand on the
  palette of the game rather than on a palette of their own, drawn through `ReadPalette` of `ImageBIZ.cs` from
  two companions of the engine, `GRP_TBL.SYS` and `PLT_TBL.SYS`, with a table of mappers that name the place
  of a palette within `PLT_TBL.SYS` by the pair of the size of the two companions (`GrpMap`) and with a
  renaming of the words of a picture of the places of a picture of a person before the naming. These two
  stand together: the palette stands in one place of `ImageBIZ.cs` and serves both, so the place to start is
  that one, not either picture. The walk of the places of a `BIZ` picture is four words of a head and a walk
  of the places of the picture the words of which stand beside them, and the walk of `GIZ/2` is four places
  of a picture walked in strips of eight places; the palettes are the whole of the difficulty.

- **DCF** (`ArcFormats/AliceSoft/ImageDCF.cs`, the kinds `dcf ` and `pcf `) — a picture of this kind stands as
  the marks a picture of the engine stands *over* a picture behind it rather than as the places of a picture of
  its own, so the reference reads a picture of the kind `QNT` standing beside it in the places of the game: the
  words of the head of the picture name the picture it stands over, and `ReadBaseImage` stands the words of it
  against the places of the game (`VFS.FileExists`, `VFS.CombinePath`) and reads the places of the picture of
  the kind `QNT` where they stand, standing the places of the picture of no picture behind it as the places of
  the picture of a kind of its own. The words the picture names the picture it stands over with stand walked as
  the reference walks them, of the places of a picture of the names of the pictures of the engine, and stand
  told by a place of the words of the game (`AfaEncoding`, the places of a picture of the words of the engine
  told by the game rather than by the reference). A picture of this kind therefore stands unread without the
  places of the game it stands beside.

## The entries read line by line against the reference

Screened by the places the reference stands in rather than by the bytes the support report names them by, these
small entries still stand unread, every one of them for a reason that stands in the reference itself:

- **GPK/STACK** (`ArcFormats/Stack/ArcGPK.cs`) — the places of the archive stand in an index of its own at the
  end of the file, under the words `STKFile0PIDX` and `STKFile0PACKFILE`, standing as a stream of the places of
  a picture encrypted with a walk the game names. The reference draws that walk from the words of the game: it
  reads the resource `CIPHERCODE` of the kind `CODE` out of an `.exe` standing beside the archive or beside the
  directory of it. No archive of this kind can be read without a game's words beside it.
- **AF2** (`ArcFormats/CsWare/AudioAF2.cs`) — the reference stands as a head of thirty-two places and stops
  within the walk of it: it stands the words of a picture of its own (the places of a picture each second, the
  places of a picture, and how many places a place of a picture stands for) and stands nothing behind them, no
  places of a picture and no return. The places of a picture of a kind stand as the place of a picture of the
  words of the head — which the reference stands as the places of a picture each second multiplied by the
  places of a place of a picture, a place of a picture standing as the places of a picture of every channel of
  it, so that the words of the head stand wrong for any picture of more than one channel. There is no walk of
  the places of a picture to port.
- **BIN/DXLIB** (`ArcFormats/DxLib/ArcDX8.cs`) — the reference stands the words of the head of a version of
  the archive of the kind `DXA`, stands the walk of the words of it over the index, and then stands the words
  `// decrypt-2` and `// decompress` where the places of the kind of the archive behind the walk stand, and
  stands `null` behind them. The walk of the places of the archive stands unwritten.
- **DXA** (`ArcFormats/DxLib/ArcDX.cs`, the kind the entry above stands on) — the archive of the engine stands
  as an index walked with words the game names, and the reference draws them from the place of the person
  reading rather than from the archive: its list of the words of the kinds of the engine stands empty
  (`DxScheme.DefaultScheme`), the person reading it is asked for a word through `WidgetSCR.xaml`, and the words
  the person names stand held in that list for the places behind them. Five hundred and ninety places of the
  reference stand on a word that stands nowhere in it.
- **BYTES/UNITY** (`ArcFormats/Unity/ArcSpVM.cs`) — the archive is a picture of the places of a picture named
  `…DAT.bytes` beside a picture of the words of its places named `…INF.bytes`, and the places of the archive
  stand as a stream of the kind the places of the .NET kind stand in: the reference stands the stream of the
  places of a picture through `BinaryFormatter` of the .NET kind, with a binder of its own standing the kind
  `SpVM.Library.LinkerInfo` of the words of the game onto a kind of its own. Reading such a stream stands as
  reading the places of the kind the .NET kind stands them in — records of the kinds of the .NET kind, of the
  words of the kinds of them, and of the places of a picture — which stands outside the place of a picture of
  this project.
