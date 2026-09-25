# Sarang compressed bitmap (`ABC`)

* Reference: `GARbro/Legacy/Sarang/ImageABC.cs`, classes `AbcFormat` and `AbcDecoder`
* Port: `packages/formats/src/sarang/abc-image.ts`, record `sarang-abc-image`
* Tests: `tests/formats/sarang-abc-image.test.ts`

## The picture of the engine

A picture of this engine is a compressed **bitmap** or **texture**: the walks of the file read the places of
a picture of one of those two kinds, and the reader of that kind reads the places of it. The reference
hands the places of the picture it has read to the readers of a bitmap and of a texture; this port does the
same, of `readBmpImage` + `writeBmpImage`, and of `readDdsLayout` + `readDdsPicture` + `writeBmp32` (the
reader of a texture of this project hands a texture over as a bitmap of the places of it, of a height of
the other way up, exactly as the entry of that format does).

## The head of a picture

* a place of four bytes: the count of the places behind the walks of the picture, of `0x38` to
  `4096*4096*4`;
* the walks of the engine, of the place of the fourth byte of the file on. **The word the head of a picture
  stands of is the first word of the walks of it themselves** -- the reference reads a place of four bytes
  at the fourth place of the file and asks whether it stands of `0x????1321` or of `0x620A1122`, and the
  walks of the picture are read from that very place. This port reads the walks from the same place, so the
  word stands of the walks of the picture and cannot be read apart from them.

The places of the picture behind the walks are read to tell the picture: the places of the walks of a
bitmap begin with the places of the word `0x????1321` (of `BM` behind them), and the places of the walks of
a texture would begin with the places of the word `0x620A1122`. A picture of a texture cannot stand behind
that word, of the walks of this engine: the walks name the places of the picture of the word itself first,
and a word of `0x620A1122` stands of the places `DD)` and not of the places of `DDS `. The port reads the
places of a texture all the same, of the reader of a texture of this project, and covers it of a test of
its own.

## The walks of the engine

`AbcDecoder` is a walk of the places of a picture, of a tree of the places of it, of a list of the places
of every one of them, of a list of the places of the walks standing in front of the places of them, and of
the bits of the file itself:

* a place of the walks of the picture stands either of the eight places of the file itself (a bit of
  nought and then eight places of the file) or of a place of the walks of the picture standing before it
  (a bit of one and then the number of places of the walks of the picture behind it, of a count of the bits
  of it that grows by one every time the places of the walks of the picture double);
* the places of a place of the walks of the picture are read of the tree of them, of the place of it at the
  end, and stand of the places of the walks of the picture before them -- the lists of the places of the
  walks of the picture are those of the walks standing in front of one another, of the place of a picture
  standing of the places of a hundred of them;
* behind every place of the walks of the picture the places of the walks behind it stand of the places of
  the picture before them (a place of the walks of the picture standing of the place of the walks before it
  and of a place of the picture).

Deviations from the reference, of this port:

* the reference reads its places into a buffer of a hundred of them and would stand beyond the end of it
  where the walks of a picture name more places than that; this port stands of an `INVALID_ARCHIVE` there
  instead, of the same counts;
* the reference reads the places of the file past the end of them as a place of `-1`; the reader of this
  project fills them with noughts, of which the walks of the picture stand of the places of a picture of
  noughts. A picture whose walks stand short of the file therefore stands of no picture of the reference
  (neither `BM` nor `DDS `), which this port reads the same way.

The `BM` and `DDS ` marks the reference asks for are read off the places of the picture the walks have
produced (up to `0x6C` places of them, or the whole count where it stands below that).
