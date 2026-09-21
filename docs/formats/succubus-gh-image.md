# Succubus image

Reference: `ArcFormats/Succubus/ImageGH.cs`, classes `GhFormat` (tag `GH`) and `GhpReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License. Implemented as `succubus-gh-image`
(`packages/formats/src/succubus/gh-image.ts`).

## The head, and the two versions

A picture of this engine opens with the words `GHP3` or `GHP2`, and the digit behind them is the version its
own fields are read by:

* **the second version** keeps the place of its palette at 0x14, the number of chunks its walk stands for at
  0x18, and the place of its run at 0x1C;
* **the third version** keeps the palette at 0x18 and the run at 0x24, and stands for no chunks.

Both carry their width at 0x0C, their height at 0x0E and the number of colours at 0x10. A picture is always
of **one byte a pixel**, and the width of an index is taken from the number of colours: one bit for two
colours, four for sixteen, eight for the whole palette. Its palette is kept **red first**, of three bytes a
colour, where the writers of this project take blue first and four bytes an entry.

**The third version's pixels are not read here**, because the reference itself leaves them unwritten:
`GhpReader.Unpack3` builds its row table and then throws. This port refuses a picture of that version by
name, both when it is read and when an entry is opened.

## The bits, and where they come from

The walk reads bits through a cache of **four bytes** gathered with the *first* byte in its lowest place, and
then reads from the **top** of that cache. A group of four bytes is therefore consumed from its **last**
byte's highest bit down to its first byte's lowest, before the next four are gathered. Two of the walk's own
numbers are not of a fixed width: a run of ones stands before every one of them, and a table gives the width
and the base each run's length stands for.

## The walk of the second version

A place is read before the first value, and **left aside** - the walk reads one number more than it uses. Then,
for as many chunks as the head names:

* while no repeat is left, a two-bit number is read. Above two it brings a counted run behind it; otherwise
  it is the step of a vertical repeat, where a pixel is written below the last one rather than at a place of
  its own;
* the value stands at the place named, and that place is **marked**;
* when the step was the place-naming kind, the next place is read and the value behind it, and the walk jumps
  there - the place is counted in pixels from the left of the picture, and its row is found by dividing by
  the width;
* otherwise the walk steps down one row and along by that step.

Every place the walk never marked then takes **the value written last**, so the right hand side of a row is
filled from the left of it.

## Deviations from the reference

* The walk works in rows of four bytes, as the reference does, and this port draws them together before
  writing a bitmap, since the writers of this project take packed rows.
* A place that falls outside the picture is not written; the reference would write past its own buffer.
* The third version, whose pixels the reference throws for, is refused by name.
* Every read is bounded to the file, a picture of no size is refused, and a palette that reaches past the
  file is refused rather than read.

## Verification

Eight tests. Two cover the head: both versions field by field, and the width an index takes from a number of
colours (one, two, sixteen, seventeen and the whole palette). The pictures themselves are built from their
bits by hand, in the **order the walk's cache consumes them** - four bytes at a time from the top - so the
fixtures pin the cache's own quirk as well: the place read before the walk begins, a chunk marker that brings
its own count, the division of a place into a row and a column, the marking of a place, and the fill that
gives every unmarked place the value written last. One fixture carries two chunks and one three, so the row
the third value stands on is shown to keep its own value rather than the last one. The rest cover the palette
as the engine wrote it (red first, taken to blue first), the refusal of the third version, the refusals of a
wrong word and a head that stops short, and the words of the picture.

What stands on the reference alone: the third version's pixels are never read here, the step of a vertical
repeat is only reached by the fixtures that carry two chunks, and no real picture is on hand to compare
against GARbro's output.
