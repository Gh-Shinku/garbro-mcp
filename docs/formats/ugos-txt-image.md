# μ-GameOperationSystem tiled bitmap

Reference: `GARbro/ArcFormats/uGOS/ImageTXT.cs`, classes `TxtFormat`, `TxtMetaData` and `Tile`, with the
pictures of its places read by `ArcFormats/uGOS/ImageDET.cs`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/ugos/txt-image.ts` (`ugo\\TxtDescriptor`, `ugo\\TxtFormat`, id
`ugos-txt-image`, `readUgoTxtLayout`).

This picture of the engine stands as words rather than as places of a picture: a file of the kind of files that
name the places of a picture names how wide and how tall a picture stands, how many places of the picture a
place of a tile of it stands in, and then a place of a picture of its own for every tile of the picture. The
reference reads the places of every tile out of the pictures beside the words and stands them into one picture.

## The words

The reference reads no word of its own and tells such a file by the words of the kind of files it stands as,
which stand in the last places of the name of the file. The first words of the file stand as the words of a
picture: how wide and how tall it stands and how many places of a picture a place of a tile of it stands in.
Every words behind those name a place of a picture of its own, the places of which stand beside the place the
words name rather than behind it, and the places of the tile then stand in places of the picture rather than in
places of a tile.

## Deviations from the reference

- The reference reads the places of a picture of the engine out of the pictures the words name and stands them
  into one picture; this project reads no places of such pictures, so this port names the places of a tile of a
  picture and hands them out as they stand, and reads no picture of its own.
- The reference reads the places of a tile of a picture out of a picture of the kind that stands as the places
  of a picture of the engine; this port reads no such picture and reads no places of a tile at all.
- The reference reads the words of a file of this kind as the words of the engine stand, which this kind of
  file system reads as the words of the kind of file systems that name them; this port keeps the places of the
  words as they stand.
- A file of more places than the words of such a file may stand in, a head that names no picture or no places
  of a tile, a words that names no place of a picture, and pictures of no places at all are turned away; the
  reference would throw while reading them.

## Tests

`tests/formats/ugos-txt-image.test.ts` covers the words that name the places of a picture and those it is
turned away for, the places of the tiles of a picture handed out as they stand, a picture whose tile stands
nowhere, and the words of the kind of files the picture is told by.
