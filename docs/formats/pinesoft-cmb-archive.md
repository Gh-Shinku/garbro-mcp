# PineSoft resource archive

Reference: `Legacy/PineSoft/ArcCMB.cs`, class `CmbOpener`. The walk the packed entries are read with is GARbro's
own `ArcFormats/LzssStream.cs`. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as
`pinesoft-cmb-archive` (`packages/formats/src/pinesoft/cmb-archive.ts`).

## The archive stands in the name and in a table

An archive of this engine writes no word of its own. It is told by its name - a number and the extension `.cmb`
- and by the places of its entries, which the reference keeps in a table of its own, one row of whole bytes to
every archive of a game, a place of every byte set standing for an entry that stands not there. The last place
of a row has to name the end of the archive itself, which is what tells an archive of this engine from a file
that merely carries its name. An entry is named after the place of its own within the row, five places long,
and how long it is comes from the place of the entry behind it.

The table of the reference names one game and its eight archives; it stands in this project as
`packages/formats/src/pinesoft/cmb-layout.ts`, taken from the source of the reference as it stands there.

## The kinds of the entries

An archive of this engine names no kind of its own either, so the reference reads a few words of every entry:

* a word of `OggS` names a sound;
* a word whose low halves stand as `0x4450420F` names a picture the engine packs, whose length is the long word
  in front of that - the entry is then handed over **behind** that head, and read through the walk below;
* an entry whose first long word is worth a word its length is short of eighteen bytes names another sound;
* an entry too short to name anything stands as it is;
* an entry whose first long word stands as four bytes to the entry behind it, its own places and a head of
  forty bytes, holds an archive of its own.

## The walk of the packed entries

The walk is the reference's own: a frame of four thousand bytes whose writing place begins near its end, a
control byte naming eight decisions from its **lowest** bit up - a set bit a byte of its own, a clear one a copy
out of the frame whose place is the two bytes behind it, most of the second of them, and whose length counts
from three. A copy is read progressively, so a run that reaches into itself runs on.

## Deviations from the reference

* Every read is bounded by the file, and the places of a table are checked against the length of the archive
  before an entry is named; the reference trusts the table.
* The length a packed picture unfolds to is held to what its own head names, where the reference reads as much
  as the walk offers.
* Writing an archive is not implemented, as in the reference.

## Verification

Six tests over synthetic fixtures and the table of the reference itself (`tests/formats/pinesoft-cmb-archive.test.ts`):
the table, its eight archives and the places of the first of them; the rule that tells an archive of the game
by the number of its name; the places of an archive and the lengths between them, with the last place of an
archive held to its end; the four kinds of entry an archive names, every one of them told by the words of its
own with a picture handed over behind the head of its length; the walk of a packed entry, written by hand
around the frame of it; and a file whose name stands no archive of the game.

An archive of a real game is not held here: the rows of the table name archives of tens of megabytes, so the
fixtures stand on the places and the words of them rather than on an archive of that size.
