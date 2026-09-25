# MAI engine colour map image (`MSK/MAI`)

* Reference: `GARbro/ArcFormats/MAI/ImageMAI.cs` (`MaskFormat`), GARbro commit
  `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT.
* Port: `packages/formats/src/mai/image-mai.ts` (`maiMskImageFormat`, id `mai-msk-image`); the two other
  walks of the same file stand at `mai-cm-image` and `mai-am-image`.
* Tests: `tests/formats/mai-image.test.ts`.

The picture of the engine of `CM/MAI` of the places of a colour map of the file themselves: the colour map
of `0x100` words stands at `0x10`, of four places of the file to a word, and the places of the picture
behind it.

## Layout

The file opens with the count of the places of the file of it at 0 (which must stand of the places of the
file themselves), the width at 4 and the height at 8 (four places each) and a place of the walk of the
places of the picture at `0x0C`: of nought where the places of the picture stand of the places of the file
themselves (of the count of the places of the picture, of the colour map of `0x400` places and of the head
of `0x10` places, which must stand of the count of the places of the file) and of one where the walk of the
runs of the places of the file stands behind the colour map.

The reference stands of no walk of the walk of the places of the file behind the head of `0x10` places where
the picture stands of the walk of it: the port stands of the places of the file of the colour map of the
picture as well.

## Deviations

* **A picture of a count of the places of the file of the count of the places of the picture alone.** Refused
  with `INVALID_ARCHIVE`; the reference reads the places of the file behind the picture as noughts.
* **Packing a picture.** The reference stands of a format of its own, standing of no packer.
