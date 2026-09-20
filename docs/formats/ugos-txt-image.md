# μ-GameOperationSystem tiled bitmap

Reference: `GARbro/ArcFormats/uGOS/ImageTXT.cs`, classes `TxtFormat`, `TxtMetaData` and `Tile`. The pictures of
which the project does not read; the reference names the kind of those pictures `BMP/uGOS`, and the archive of
the engine stands in `ArcFormats/uGOS/ArcDET.cs`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/ugos/txt-image.ts` (`ugoTxtDescriptor`, `ugoTxtFormat`, id
`ugos-txt-image`, `readUgoTxtLayout`).

This picture of the engine stands as words rather than as places of a picture: a file of the kind of files that
place of a tile of it stands in, and then a place of a picture of its own for every tile of the picture. The

## The words

The reference reads no word of its own and tells such a file by the words of the kind of files it stands as,
picture: how wide and how tall it stands and how many places of a picture a place of a tile of it stands in.
places of a tile.

## Deviations from the reference

  picture and hands them out as they stand, and reads no picture of its own.
  of a picture of the engine; this port reads no such picture and reads no places of a tile at all. That kind
  tables it stands as places of its own; reading it stands as a picture of its own rather than as a part of
  this one.
  words as they stand.
- A file of more places than the words of such a file may stand in, a head that names no picture or no places
  of a tile, a words that names no place of a picture, and pictures of no places at all are turned away; the
  reference would throw while reading them.

## Tests

nowhere, and the words of the kind of files the picture is told by.
