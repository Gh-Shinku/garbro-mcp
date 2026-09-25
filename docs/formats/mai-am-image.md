# MAI engine image with an alpha (`AM/MAI`)

* Reference: `GARbro/ArcFormats/MAI/ImageMAI.cs` (`AmFormat`), GARbro commit
  `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT.
* Port: `packages/formats/src/mai/image-mai.ts` (`maiAmImageFormat`, id `mai-am-image`); the two other
  walks of the same file stand at `mai-cm-image` and `mai-msk-image`.
* Tests: `tests/formats/mai-image.test.ts`.

The picture of the engine of `CM/MAI` and of an alpha of its own, of the walk of the runs of the places of
the file (`RleDecoder.Unpack`). The places of the picture of it stand of the four places of a place of the
display of every picture: the blue, the green, the red and the alpha of it.

## Layout

The file opens with `AM`, the count of the places of the file of it at 2 (which must stand of the places of
the file themselves), the width at 6 and the height at 8, the width and the height of the alpha of the
picture at `0x0A` and `0x0C`, the count of the words of the colour map of it at `0x12`, the count of the
places of a colour of it at `0x14` (eight, twenty four or thirty two), a place of the walk of its places at
`0x15`, the kind of the picture at `0x16` (one or two), the place `1` at `0x18`, the place of the places of
the picture at `0x1A`, the count of the places of the walk of them at `0x1E`, the place and the count of the
places of the alpha of it at `0x22` and `0x26` and a place of the walk of the alpha at `0x2A`.

The colour map stands at `0x30`, of three places of the file to a word. The alpha of the picture stands of
the count of the places of the file of it where the place of the walk of it stands of the count of the
places of the places of the picture (the width and the height of the picture, less one place of the file to
a place of the walk of it); of the count of the places of the walk of it behind.

The places of the picture stand of the alpha of the row of the file of it the same row: the places of the
picture of the row of the display the first stand of the last row of the places of the file, and the alpha
of the row of the display the first stands of the first row of the alpha of the picture.

## The alpha of a picture of a colour map

A picture of eight places to a place stands of a colour map: the colour of the word of the colour map of a
place of it, and the alpha of it:

* where the colour of the word stands of the colour of no alpha of the engine (`0x00FE00` of the red, the
  green and the blue of it), the alpha of the place stands of nought.
* where the alpha of the place of the file stands of nought, the alpha of the place stands of the whole
  place.
* else the alpha of the place stands of the count of the places of the file of it times `0x11`.

## Deviations

* **A picture of a colour map of no words.** Refused with `INVALID_ARCHIVE`; the reference stands of a
  colour map of no words and reads the places of the file behind it.
* **A place of the alpha of the picture beyond the places of the alpha of the file.** Refused with
  `INVALID_ARCHIVE`; the reference reads the places of the file behind the alpha of it.
* **A picture of a count of the places of the file shorter than the places of it.** Refused with
  `INVALID_ARCHIVE`; the reference reads the places of the file behind the picture as noughts.
* **Packing a picture.** The reference stands of a format of its own, standing of no packer.
