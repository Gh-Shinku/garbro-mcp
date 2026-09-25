# Ivory image (`SG`)

* Reference: `GARbro/ArcFormats/Ivory/ImageSG.cs` (`SgFormat`, `SgRgbReader`)
* Port: `packages/formats/src/ivory/sg-image.ts`, record `ivory-sg-image`
* Tests: `tests/formats/ivory-sg-image.test.ts`

The archive of the same engine is a different format (`ArcFormats/Ivory/ArcSG.cs`, ported as
`packages/formats/src/ivory/sg.ts`).

## Layout

The file opens with `fSG ` and a block of 0x24 bytes from offset 8. The block opens with a word naming the
kind of its picture, `cRGB` or `cJPG`, and holds a size at 8 and a count of the places of the picture at
0xC; `header_size + 8` names where the places stand.

* `cRGB`: the kind of the walk at 0x10, the place of the picture at 0x18 and 0x1A, the measurements at 0x1C
  and 0x1E and the depth at 0x22 (0x18 or 0x20).
* `cJPG`: the place of the picture at 0x14 and 0x16, the measurements at 0x18 and 0x1A, and the key at 0x20.

## The kinds of walks of a picture of places (cRGB)

| kind | places |
| --- | --- |
| 0 | as they stand, three or four places to a place, of a tight stride |
| 1 | per colour of the row, of a run over the places of that colour, then the places of the row drawn together |
| 2 | of a colour map behind the head and a walk of the places of every row |
| 3 | of a walk of the places of every row, of three or four places to a place |

The walks of kind 1 and kind 2 (of the places of the file) stand of a control byte: the lowest six places
of it are a count, the next names a count of two places, and the highest a run of one place behind it.
Kind 2 and kind 3 name the places of every row of the picture of a table of one i32 per row behind the head
or the colour map, and the places of a row stand where the table says. Kind 2 of a colour map stands of a
picture of eight places to a place; of four places to a place every place of the picture stands of a walk
of bits, of the lowest place of every place of the file first: two places of a count (of two or of ten
places), a place of an alpha of four places (of `(a << 4) | 0xF` where it stands of a value other than
nought) and a place of the colour map of eight places.

## Deviations

* **A picture of a kind of its own (cJPG).** The project reads none of the pictures of that kind: the
  places behind the key of the head stand handed over as they stand once the key is taken away from them,
  and the entry of the format stands named as a picture of that kind.
* **A kind of walk this project reads none of.** Refused with `UNSUPPORTED_FEATURE`.
* **Places past the end of the file.** Refused with `INVALID_ARCHIVE`.
* **A walk naming more places than its colour holds.** The port writes the places of the line alone; the
  reference stands of the places beyond the line of a picture. The places of the picture itself are read
  of the first places of every colour of a row.
