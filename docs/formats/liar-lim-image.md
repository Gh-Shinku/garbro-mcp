# Liar-soft proprietary image (`LIM`)

* Reference: `GARbro/ArcFormats/Liar/ImageLIM.cs` (`LimFormat`, `LimFormat.Reader`)
* Port: `packages/formats/src/liar/lim-image.ts`, record `liar-lim-image`
* Tests: `tests/formats/liar-lim-image.test.ts`

A second picture of the engine of `WCG` (`ArcFormats/Liar/ImageWCG.cs`), of a format of its own. Every walk
of it stands of the words of a table of its own, as the walks of `WCG` do.

## Layout

The file opens with `LM`, a word of flags at 2 whose lowest place must read 2 or 3, the count of the places
of a colour at 4 (`0x10` stands of sixteen, anything else of thirty two) and a word the reference reads and
lets stand; the width stands at 8 and the height at 12. The places of the picture open at `0x10`.

A picture of thirty two places to a place stands of four walks one behind another, of the places of a
channel of the picture each: the alpha of the picture first (of the places of the file the other way round),
then the red, the green and the blue of it — the first walk of them stands of the alpha, of the fourth place
of every place of the picture.

A picture of sixteen places to a place stands of the colours of it as they stand where the places of the
colours stand of no walk; a walk of the words of a table of its own stands where the flags of the picture
stand of the places `0x20` to `0x80`. The alpha of the picture stands of a walk where the flags stand of
the places `0x100` and `0x200`, and as the places of the file as they stand where they stand of `0x100`
alone; the places of the picture then stand of a colour of four places, of the five places of every place
of the colour of the picture read as the places of the file of a colour of sixteen places to a colour, and
of the alpha of the picture the other way round.

## The walk of a channel

A walk opens with the count of the places of its channel, the count of the places of the file of the walk
itself, the count of the places of the words of the table of it (of the count of the words of the table
twice over where the walk stands of a word table of a picture of sixteen places to a place), a word the
reference reads and lets stand, and the words of the table.

The walk itself reads a count of the places of a count: three where the table stands of 8192 places or
fewer and four where it stands of more; of fourteen and sixteen places behind it where it stands of more.

* A count of nought stands of a count of the places of a run behind it (four places, of two places more
  than the count stands of) and then of the count of the words of the places of it.
* A count of one stands of one place of the file, the first place of the table or the second of them.
* A count of n stands of the places of the file behind the head of it: nought to `n - 1` places and then of
  the nought to `n` places of the table that follow.
* Where the count stands of the last count of the table of the walk, the places of the file behind the
  count stand of ones: every one of them stands of one place more of the count, up to the count of sixteen
  places of the walk.

A place of the picture of a picture of thirty two places to a place stands of one word of the table; a
place of a picture of sixteen places to a place stands of two places of the file, the two places of the
word of the table of the walk.

## Deviations

* **A picture of a place standing of one place of the file, the last of a walk.** The walk ends where the
  place behind the place it stands of is the last of the picture, as the reference has it; the last place
  of the picture then stands of the places of the picture as they stand there.
* **A count of the places of a walk beyond the places of the file behind it.** The places of the file
  behind it read as noughts, as the reference reads them; every place of the walk behind the last of them
  stands of the places of the picture as they stand there.
* **A table standing short of the file and a walk of a count of the places of the file beyond the picture.**
  Refused with `INVALID_ARCHIVE`; the reference reads the places of the file behind the table as noughts and
  stands of the places of the picture beyond the picture of it.
* **A picture of a count of places the engine knows none of.** The count of the places of a colour at 4
  stands of thirty two where it reads anything but `0x10`, as the reference has it; the reference refuses
  the count of the places of a colour of nought alone, of a picture of no width or height of it.
* **A channel standing of a count of the places of its own.** The walk of it stands of the places of the
  picture, as the first walk of the reference stands of the count of the places of its channel; the count of
  the places of a channel the file carries stands of no walk of the picture where it stands beyond the
  places of the picture the walk of the reference stands of.
* **Packing a picture.** The reference stands of a format of its own, standing of no packer.
