# Liar-soft proprietary image (`WCG`)

* Reference: `GARbro/ArcFormats/Liar/ImageWCG.cs` (`WcgFormat`, `WcgFormat.Reader`)
* Port: `packages/formats/src/liar/wcg-image.ts`, record `liar-wcg-image`
* Tests: `tests/formats/liar-wcg-image.test.ts`

The picture of the same engine of `LIM` (`ArcFormats/Liar/ImageLIM.cs`) stands of a format of its own.

## Layout

The file opens with `WG`, a word of flags at 2 whose lowest place must read 1, the places `0x20` and nought
behind it, and the width and height of the picture from 8. Every place of the picture stands of four places.

Two walks stand behind the head, of the places of the file: the first writes the third and fourth places of
every place of the picture (the red and the alpha of it) and the second the first two (the blue and the
green); the alpha of every place then stands of the places of the file the other way round.

A walk stands of a head of twelve places: the count of the places of the picture it stands of (two places
each), the count of the places of the words of it, and the count of the words of the word table; then the
words of the table, two places each, and the walk of the words behind them.

## The walk of the words

A walk of the bits stands of the head of a place of the count of the words and of the places of the count:
of four places where the word table stands of 0x1002 words or fewer and of three where it stands of more.

* A count of nought stands of a count of the places of the walk behind it (four places, of two places more
  than the count stands of) and then of the count of the words of the places of the walk; a count of the
  words of nought ends the walk there.
* A count of one stands of one place of the file, the first place of the word table or the second of them.
* A count of n stands of the places of the file behind the head of it: nought to forty seven places and
  then of the nought to `n` places of the word table that follow, of the counts of one to `n - 1` places.
* Where the count stands of the last count of the word table of the walk, the places of the file behind the
  count stand of ones: every one of them stands of one place more of the count, up to the count of sixteen
  places of the walk.

## Deviations

* **A walk standing short of the file.** Refused with `INVALID_ARCHIVE`; the reference reads the places of
  the file behind it as noughts.
* **A place of the word table beyond the words of the walk, and a count of the places of the picture beyond
  the picture**: the walk ends there, as the reference has it, and the walks behind it stand of the places
  of the file alone where the walk before them stood of no places of its own.
* **A place of the picture beyond the picture.** The places stand of the picture alone; the reference stands
  of the places beyond it.
