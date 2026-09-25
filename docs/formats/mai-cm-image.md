# MAI engine image (`CM/MAI`)

* Reference: `GARbro/ArcFormats/MAI/ImageMAI.cs` (`CmFormat`), GARbro commit
  `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT.
* Port: `packages/formats/src/mai/image-mai.ts` (`maiCmImageFormat`, id `mai-cm-image`); the two walks of
  the same file stand at `mai-am-image` and `mai-msk-image`.
* Tests: `tests/formats/mai-image.test.ts`.

## Layout

The file opens with `CM`, the count of the places of the file of it at 2 (which must stand of the places of
the file themselves), the width at 6 and the height at 8, the count of the words of the colour map of the
picture at `0x0A`, the count of the places of a colour at `0x0C` (eight, twenty four or thirty two), a place
of the walk of the places of the picture at `0x0D`, the place `1` at `0x0E`, the place of the places of the
picture at `0x10` and the count of the places of the walk of them at `0x14`.

The colour map stands at `0x20`, of three places of the file to a word (the blue, the green and the red of
it), where the picture stands of a colour map. The places of the picture then stand where the place of them
of the head stands of them.

The picture stands of the row of the file the last first: the places of the row of the display the first
stand of the last row of the places of the file.

## The walk of the places of the file

The walk of the runs of the places of the picture stands of `RleDecoder.Unpack`:

* A place of the walk of less than `0x80` stands of that count of the places of the picture, of the places
  of the file behind it, the count of the places of a place of the picture to a place of the file.
* A place of the walk of `0x80` stands of no walk of the places of the file and is refused.
* A place of the walk above `0x80` stands of that count less `0x80` of the places of the picture, all of
  them the count of the places of a place behind it — a place of the file to a place of the picture, of the
  places of the file behind it the same, up to the count of the places of the run.

## Deviations

* **A picture of a colour map of no words.** The reference stands of a colour map of no words of its own
  where the count of the words of it stands of nought; the port stands of a colour map of the words of the
  file behind it, of the count of the words of it, and of noughts where the colour map stands of none of
  them.
* **A picture of a count of the places of the file shorter than the places of it.** Refused with
  `INVALID_ARCHIVE`; the reference reads the places of the file behind the picture as noughts.
* **Packing a picture.** The reference stands of a format of its own, standing of no packer.
