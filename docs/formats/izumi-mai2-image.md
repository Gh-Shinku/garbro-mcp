# Izumi engine image (`MAI/IZUMI`)

* Reference: `GARbro/Legacy/Izumi/ImageMAI2.cs` (`Mai2Format`, `Mai2Reader`)
* Port: `packages/formats/src/izumi/mai2-image.ts`, record `izumi-mai2-image`
* Tests: `tests/formats/izumi-mai2-image.test.ts`

The picture of the same engine of four places to a place stands of a format of its own
(`Legacy/Izumi/ImageMAI3.cs`, ported as `packages/formats/src/izumi/mai3-image.ts`).

## Layout

The file opens with `MAI2` and a head of 0x14 bytes: the place of the picture as two counts (the column of
it by 0x50, and the row), the width in eight place units at 6, the height at 8, a word of flags at 0xA and a
count of the places of every one of the four planes from 0xC. The highest place of the flags names a colour
map of the picture, and the four lowest the planes that stand of the places of the file.

A colour map stands behind the head: sixteen colours of three places, of four places each and of the
highest place of every place of the file first, every place of a colour standing of sixteen steps. A
picture of no colour map stands of sixteen places of grey.

## The planes

The picture stands of four planes of one place to a place of it, every plane standing of the places of the
file behind the head (the count of them names where the plane behind it stands) and holding its places
column by column: the place of a column of `height` places of the picture come first, of the columns of the
picture behind them.

The walk of a plane stands of a place of the control and a count:

| control | walk |
| --- | --- |
| 0x00 to 0x8F | the count of the lowest five places stands of the places of the plane itself: nought, of the places of the first plane, of the second, of the third, or of the places of a place of 0xFF |
| 0x90 to 0xEF | a copy of the places before them, of the places of the head of the control (0x10, 8, 4, 2, `height * 2` or `height`) |
| 0xF0 to 0xF8 | the count of the lowest four places of the places of the file itself |
| 0xF9 | the count of the places of the plane behind the control stands of no place of its own |
| 0xFA | the count of one place of the file |
| 0xFB | the count of the places of the first plane (of the second, where the highest place of the control stands) the other way round |
| 0xFC | the count of the places of the third plane the other way round, or of a pattern of two places of one place of the file |
| 0xFD | a pattern of four places, of the places of the file, of the places of the pattern behind them |
| 0xFE | a pattern of four places of the file repeated, or the places of two planes of the picture standing of one another |
| 0xFF | the places of two planes behind one another, of a place of the file or one of the three behind it |

A count of nought stands of a count of a place of the file behind the control.

## The places of the picture

Every group of four columns of the picture stands of a place of every plane: the places of eight places of
a row stand of the places of the four planes, the place of the first plane standing of the lowest place of
the place of a picture, and the places of a picture stand of two places of a place of the file.

## Deviations

* **Places beyond the plane of a walk.** A walk naming more places than its plane holds writes the places of
  the plane alone; the reference stands of the places beyond the plane of the picture.
* **A walk standing short of the file.** The port reads the places behind it as noughts.
