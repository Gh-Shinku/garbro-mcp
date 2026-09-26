# Entis rasterized picture (`ERI`)

Format reference: GARbro `ArcFormats/Entis/ImageERI.cs` (`EriFormat`, `EriMetaData`, `EriFile`,
`EriFileHeader`) and the walk of the places of the picture of the engine itself
(`ArcFormats/Entis/EriReader.cs`, the class `EriReader`), over the same head as the archives of the engine
(`ArcFormats/Entis/ArcERI.cs`), GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

The picture of the engine and the archives of the engine (`entis-eri`, of the same file) stand of **one
head**: the word `Enti`, the identifier of the kind of the file and the name of it, and then a chain of
sections of sixteen places a head. This port stands of the walk of the head (`EriFormat.ReadMetaData`) and of
the walk of the places of the picture of the kind of the counts of a picture of the engine
(`Lossless_ERI`, `packages/formats/src/entis/eri-reader.ts`); the walks of the counts of a picture of the
engine of the two ways of it and the thoughts of the kinds 2 and 4 of the walk of the places of the picture
stand unported, of the reference as well.

## The head

| place | field |
| --- | --- |
| 0 | the word `Enti` (of the kinds `VIST` as well) |
| 8 | the identifier of the kind of the file: `0x03000100` or `0x02000100` alone |
| 0x10 | the name of the kind of the file: `Entis Rasterized Image`, `Moving Entis Image` or `EMSAC-Image` |
| 0x40 | the head of the first section, `Header  ` |

The sections of the head of the file stand of the places of the head of the first section (`Header  `, of a
count of the places of it of its own): the `FileHdr ` section (the count of the kind of the file, the count
of the places of the frames of it and the count of the time of them), the `ImageInf` section (the count of
the kind of the walk of the places of it, the kind of the places of a colour of it, the counts of the picture
of it, the counts of the places of a colour of it, the counts of the walk of the places of it, and the counts
of the places of the walk of a frame) and the `descript` section (the name of the picture, of the places of
a mark of a name of the two ways of the engine in front of them).

The walk of a picture of the engine stands of the places of the picture of it alone: the reference stands of
a picture of a file of no place of a frame at all, of the count of the frames of the head of it of nothing.

## The places of the picture

A picture of the kind `Lossless_ERI` (`0x03020000`) stands of the counts of the walk of the engine of a count
of the places of a picture of a block of it: the counts of the walk of the places of the count of the walk of
the engine of the picture (`ImageFrm`) behind the counts of the walk of the engine of the picture of the
places of the head of it, of the count of the places of a colour of it (`Palette `) in front of them.

The walk of the places of the picture stand of the count of the kind of the walk of the engine (of one place
of the count of the walk of the engine of the count of the walk of the picture of its own), of the count of
the shapes of the places of the count of the walk of it and of the count of the places of a colour of it; and
then, of every count of a block of the picture, the counts of the walk of the engine of the places of the
count of the walk of it (`DecodeBytes`, of the counts of the walk of the engine of the kind
`RunlengthHuffman`, of the kind `RunlengthGamma` and of the kind `Nemesis`), of the counts of the walk of the
engine of the count of the walk of the places of the block of it (`PerformOperation`: the counts of the walk
of the engine of the count of the walk of the engine of the count of the walk of the picture itself, the
counts of the walk of the engine of the counts of a colour of the block, the counts of the walk of the engine
of the places of the picture of the count of the walk of the engine behind it and the counts of the walk of
the engine of the count of the walk of the engine of the picture in front of it) and of the counts of the
walk of the engine of the places of the count of the walk of the picture itself (`RestoreRGB24`,
`RestoreRGBA32`, `RestoreGray8`, of the counts of the walk of the engine of the places of a colour of the
count of the walk of the picture of its own).

The counts of the places of a colour of the picture (`fEncodeType & 1`) stand of the counts of the walk of
the engine of the count of a block of the picture of its own (`GetHuffmanCode`, of the tree of the counts of
the walk of the engine of the kind `0x00020200` of the head of the picture).

## Deviations

* The kinds of the counts of a picture of the engine of the two ways of it (`DCT_ERI`, `LOT_ERI`, of the walks
  of the counts of a picture of the engine) and the counts of the walk of the engine of the kind
  `ArithmeticCode` (`32`) stand refused (`UNSUPPORTED_FEATURE`), of the reference as well (the reference
  stands of the counts of the walk of the engine of the kind `ArithmeticCode` of no count of the walk of it
  at all, of a `NotImplementedException`).
* The kinds 2 and 4 of the walk of the places of the picture stand refused (`UNSUPPORTED_FEATURE`): the
  reference stands of them of a `NotImplementedException` as well.
* A picture of the kind `Lossless_EMI` (`0x03010000`) stands refused: the reference stands of no walk of the
  places of it at all.
* The places of a picture of the count of the walk of the engine of sixteen places of a colour stand refused
  (`UNSUPPORTED_FEATURE`): the reference stands of them of the counts of a colour of the places of the walk
  of the engine of the two ways of the engine itself (`PixelFormats.Bgr555`), and this port stands of no
  count of the walk of the engine of the counts of a colour of sixteen places of a count at all.
* A picture of the engine in front of the places of the walk of the picture stands of the counts of the walk
  of the engine of the places of the picture in front of it (`RestoreDeltaRGB24`, `RestoreDeltaRGBA32`), where
  the picture of the count of the walk of the engine of its own stands of them: the picture of one count of a
  colour stands of the counts of the walk of the engine of the count of the walk of the picture of its own at
  all, of the reference as well.
* A picture whose `descript` section names a `reference-file` tag stands of the places of the picture of that
  file as well (`EriFormat.ReadImageData`, of the counts of the walk of the engine of the picture of the count
  of the walk of it): a picture of fewer than twenty four places of a count stands refused
  (`UNSUPPORTED_FEATURE`), of the reference as well.
* The reference stands of the counts of the walk of the engine of the counts of a count of a block of the
  picture of no count of the walk of the engine at all: this port stands of a count of the walk of the engine
  of sixteen places of a count of a block at most, of the counts of the places of the picture of the engine
  itself.
* The places of the picture stand of a bitmap of the project: a picture of four counts of a colour of the
  places of the count of the walk of it (`RGBA`, `0x04000001`) stands of a bitmap of thirty two places of a
  colour, and a picture of the counts of a colour of the places of the walk of the engine of the two ways of
  the count of the walk of the picture itself of a bitmap of the counts of a colour of theirs (the reference
  stands of the places of a colour of the count of the walk of the engine itself, of no place of the count of
  the walk of the picture at all).
* The name of a section of the head standing of a count of the places of the file behind it stands of no
  place of it at all, as the reference stands of it: the walk of the sections ends there.
* A file of a name of another kind, of another identifier at the places of the count of it, and of no head of
  a section of a picture at all stands turned away.

## Tests

`tests/formats/entis-eri-image.test.ts` builds a picture of the engine of a `FileHdr ` section and an
`ImageInf` section, of the counts of the picture and of the kind of the places of it: the head of the picture
stands pinned (the word of the format, the identifier of the kind of it, the name of it and the count of the
kind of the places of the walk of it), a picture of no place of a frame at all stands beside it (the walk of
the head of the picture stands of the places of the picture of it alone) and a file of a name of another
kind, of another identifier and of no section of a picture at all stands turned away.

The places of the picture itself stand of a fixture of the walk of the engine of its own
(`tests/helpers/erisa.ts`, of an encoder of the counts of the walk of the engine of the port itself): a
picture of one count of a colour of one count of the walk of a block of the picture and of two counts of the
walk of it (the counts of the walk of the engine of the count of the walk of the picture of its own stand of
the counts of the walk of the engine of the count of the walk of the picture behind them), a picture of three
counts of a colour of the counts of the walk of the engine of the count of a block of its own (of the tree of
the counts of the walk of it) and a picture of the counts of a colour of its own stand of the counts of the
walk of the engine of every place of the count of the walk of the picture in front of it over each other: the
places of the picture stand pinned of the counts of the walk of the engine of the count of the walk of the
picture itself (`countedPicture`, of the counts of the walk of the engine of the reference outside this port)
and of the counts of a colour of the picture of the form of the bitmap of the engine.

The counts of the walk of the engine of the places of a picture of the kind of the counts of a picture of the
engine of the two ways of it, of the kind `ArithmeticCode`, of the counts of a picture of the engine of the
count of the walk of the engine of sixteen places of a colour and of the kinds 2 and 4 of the walk of the
places of the picture stand refused, of a picture of the counts of the walk of the engine of the count of the
walk of the picture of no count of the walk of it at all beside them (of the counts of the walk of the engine
of the head of the picture itself).
