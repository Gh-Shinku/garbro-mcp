# Entis rasterized picture (`ERI`)

Format reference: GARbro `ArcFormats/Entis/ImageERI.cs` (`EriFormat`, `EriMetaData`, `EriFile`,
`EriFileHeader`), over the same head as the archives of the engine (`ArcFormats/Entis/ArcERI.cs`), GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

The picture of the engine and the archives of the engine (`entis-eri`, of the same file) stand of **one
head**: the word `Enti`, the identifier of the kind of the file and the name of it, and then a chain of
sections of sixteen places a head. This port stands of the walk of the head alone, which is the walk the
reference stands of in `EriFormat.ReadMetaData`; the places of the picture themselves stand of the walks of
the engine (`ArcFormats/Entis/EriReader.cs`, of 2844 lines), which stand unported here.

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

## Deviations

* The places of the picture stand refused (`UNSUPPORTED_FEATURE`): the walks of the engine (the walks of the
  places of the count of the format, the walks of the places of a colour and of the places of a block of it,
  of `EriReader.cs`) stand unported. The head of the picture, the kind of the places of it and the counts of
  it stand read.
* The name of a section of the head standing of a count of the places of the file behind it stands of no
  place of it at all, as the reference stands of it: the walk of the sections ends there.
* A file of a name of another kind, of another identifier at the places of the count of it, and of no head of
  a section of a picture at all stands turned away.

## Tests

`tests/formats/entis-eri-image.test.ts` builds a picture of the engine of a `FileHdr ` section and an
`ImageInf` section, of the counts of the picture and of the kind of the places of it: the head of the picture
stands pinned (the word of the format, the identifier of the kind of it, the name of it and the count of the
kind of the places of the walk of it), the places of the picture stand refused, and a picture of no place of
a frame at all stands beside it (the walk of the head of the picture stands of the places of the picture of
it alone). A file of a name of another kind, of another identifier and of no section of a picture at all
stands turned away.
