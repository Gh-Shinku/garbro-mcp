# Tactics resource archive (`ARC/Tactics`)

* Reference: `GARbro/ArcFormats/Tactics/ArcTactics.cs` (`ArcOpener`), GARbro commit
  `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT.
* Port: `packages/formats/src/tactics/arc-tactics.ts` (`tacticsArcFormat`, id `tactics-arc`).
* Tests: `tests/formats/tactics-arc.test.ts`.

The scheme variant of the same file (`Arc2Opener`, tag `ARC/Tactics/2`) stands deferred in
`docs/deferred-formats.md`.

## Layout

The file opens with `TACT`, the words `ICS_ARC_FILE` at 4, the count of the places of the words of the index
of the picture at `0x10` (which the reference reads and uses as the length of the index stream), the count
of the places of the words of the index of it at `0x14` and the count of the pictures of it at `0x18`.

The words of the index stand at `0x20`, of the count of the places of them of the picture, and the places of
the pictures stand behind them, at `0x20` places plus the count of the places of the words of the index.

## The words of the index

Three walks of the words of the index stand, which the reference tries in turn, every one of them of the
words of the LZSS engine of the frame of `0x1000` places:

* **The first walk** stands of the words of the file themselves, of no password: every place of the words of
  the index stands of the places of the file the other way round, of five places less
  (`index[i] = ~index[i] - 5`). The first words of the index stand of the password of the picture, which the
  reference reads and lets stand: the first place of the words of the index of nought ends them. Every name
  behind it stands of the places of the file up to the place of nought behind it. The places and the counts
  of the pictures stand of the table of the places of the file at `0x20` plus the count of the places of the
  words of the index, of four places of the file to a word — the place of the first picture, the count of the
  places of it, the count of the places of it as they stand (nought where they stand as they stand) and a
  word the reference reads and lets stand.
* **The second and the third walks** stand of the words of the picture itself, of every place of the file
  the other way round (`NotTransform` of `InputCryptoStream`) and of the LZSS engine behind it. The first
  place of the words of the index of nought ends the password of the picture, of the places of the file
  before it. Every picture then stands of a word of the words of the index: the place of it (of the places
  of the file behind the words of the index), the count of the places of it, the count of the places of it
  as they stand, the count of the places of its name, and the name itself behind the word of the picture —
  of `0x18` places of the file to a word, or of `0x10` places of them where the name stands of them closer.

A picture of a count of the places of it of nought as they stand stands of the places of the file of it
themselves; else the walk of the places of the file stands of the LZSS engine behind the places of the
password of the picture, of every place of the file `^` the place of the password of it of it (`^` of the
places of the password of the picture stands of the places of the file of it and back again at the first
of them).

## Deviations

* **A count of the places of the words of the index of the picture of nought, and one of more than
  `0x10000000` places.** Refused with `INVALID_ARCHIVE`; the reference stands of the count alone, of a
  buffer of the places of the words of the index of the picture of it.
* **A walk of the places of the words of the index standing short of the places of the file of it.** The
  walk of the picture ends there and the walk behind it stands of the places of the file; the reference does
  the same (the count of the places of the walk read stands of the count of the places of the index of the
  picture).
* **A word of the index of a picture standing beyond the words of the index, a name of no count of places,
  and a name beyond the words of the index.** Refused with `INVALID_ARCHIVE`; the reference reads the places
  of the file behind the words of the index.
* **A picture standing beyond the places of the file.** Refused with `INVALID_ARCHIVE` (the reference's
  `Entry.CheckPlacement` refuses it as well).
* **The walk of the LZSS engine of the scheme of the picture (`UnpackCustomLzss`).** The walk stands of the
  engine's own scheme of a password, which the reference takes from its format database
  (`SchemeMap`/`KnownSchemes`) rather than from the picture; the walk of the pictures of it stands of no
  port. See `docs/deferred-formats.md` for `ARC/Tactics/2`.
* **Packing a picture.** The reference stands of a format of its own, standing of no packer.
