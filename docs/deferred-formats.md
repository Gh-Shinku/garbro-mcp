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
  stands in a file of nine hundred places together with places of a picture of its own.

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
