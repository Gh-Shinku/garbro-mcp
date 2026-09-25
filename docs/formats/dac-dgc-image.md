# DAC engine image (`DGC`)

* Reference: `GARbro/ArcFormats/Dac/ImageDGC.cs` (`DgcFormat`, `DgcFormat.Reader`)
* Port: `packages/formats/src/dac/dgc-image.ts`, record `dac-dgc-image`
* Tests: `tests/formats/dac-dgc-image.test.ts`

## Layout

The file opens with `DGC\0` and a head of twelve bytes: a word of flags at 4, the width at 8 and the height
at 10. The flags name whether the places of the picture stand of a colour table (`0x2000000`), whether they
stand of an alpha of their own (`0x4000000`), and the largest colour table of the picture (the lowest three
places). Three places to a place stand of the picture, or four where it stands of an alpha.

A picture is a table of rows, every row opening with a count (a word of two places):

* a count above nought names how many places of the row stand of a walk behind it;
* a count below nought names the row before it the places of the row stand of, of the whole row;
* a count of nought stands of the places of the file itself: one place of the picture after another, of
  three places each (the alpha stands behind them where the picture stands of one).

A colour table stands behind the head: a count of colours (of one or of two places, of one more colour than
the count says) and the colours of it of three places each, and then the rows. A colour table of more than
256 colours stands of groups of rows: every group holds a table of its own and the row behind the last row
of the group.

## The walks

* **Without a colour table**: controls of two places: the highest place names a run of the places before it
  (a count of one to sixty four places, at a place of sixteen to one before them), the next a place as it
  stands and then a run of it, the rest a count of places as they stand (three places each).
* **A small colour table**: controls of one place: a count of one colour of the table, or a count of places
  of the colours of the table (one place of the table for every one of them), or a run of the places before
  them (a count of four to sixty seven places, of a word of two places of which the lowest six stand of the
  count and the rest of the place behind it).
* **A colour table of its own**: controls of two places, as the walks of the picture itself, of a place of
  the table of one place where the table stands of 256 colours or fewer and of two where it stands of more.
* **The alpha** stands of walks of its own behind the walks of the colours, of one place of alpha instead of
  a colour.

## Deviations

* **Places short of the file.** A walk that stands past the end of the file is refused with
  `INVALID_ARCHIVE`; the reference stands of an exception of its own.
* **A group of rows that names no rows.** Refused with `INVALID_ARCHIVE`; the reference would stand of the
  group for ever.
* **A row standing of no row.** Refused with `INVALID_ARCHIVE`.
* **The place behind the alpha.** The reference names the place behind the places of the alpha without the
  places of a place of the picture, so the walks of the alpha stand of the places of the file and not of the
  places of the picture. The port reads it as the reference does.
