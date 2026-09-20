# AdvSys engine compressed image format

Reference: `GARbro/ArcFormats/AdvSys/ImageGR2.cs`, classes `PolaFormat`, `PolaMetaData` and `PolaReader`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/advsys/pola-image.ts` (`advsysPolaImageDescriptor`,
`advsysPolaImageFormat`, id `advsys-pola-image`, `readPolaLayout`) over the walk in
`packages/formats/src/advsys/pola-reader.ts` (`unpackPolaPicture`, `POLA_TAIL`). The picture the walk stands
for is read as a picture of the raw kind of the same engine, so this port stands on
`packages/formats/src/advsys/gr2-image.ts`.

## The head

The words `*Pola` stand in the first places of the file — the words the reference stands in the places of a
picture of this kind are the four places `*Pol`, and the words the walk of the kind of the picture stands in
stand behind them. The kind of the walk of a picture stands as the words `*  ` behind the words of the kind of
the picture: the places of the head of a picture of the second kind stand behind the words of the kind of the
walk of a picture and the places of the pictures of the two kinds stand apart. Behind the kind of the walk
stands how many places the walk of the picture stands for.

## The walk

The walk of the places of a picture and the places of the picture it stands for stand in the **same** stream, so
a stream of this kind stands as words of the walk that stand beside the places of the picture: a word of the
walk holds sixteen places of the walk, and a word of the walk stands before the places of the picture it stands
for. A word of the walk of a picture that stands names a place of the picture that stands for itself, standing
as a place of the picture of its own behind the word of the walk; a word of the walk that stands clear names a
place of the picture that stands for the places behind it, told by a walk of a kind of its own:

- a place of the walk of the picture that stands a place of the walk of a picture of its own, of the places
  behind the walk, and the places of the picture that stand for themselves, whose count stands as the places of
  a picture of a walk of a kind of its own (of three places or more, of the places behind the walk, or of a
  count of the places of the picture of its own);
- a place of the walk of the picture that stands for **two** places of the picture, told by the places of a
  picture of a walk of a kind of its own, standing for the places behind the walk of a picture of a kind of its
  own.

The walk of the places of a picture stands two places short of the places of the picture it stands for, so the
last two places of the walk stand as they stand. The place of the walk of a picture stands within the places it
stands for, so a walk of the places of a picture that stands within them stands as a walk of the places written
a moment ago — this port stands them the same way.

## The picture the walk stands for

The places a walk of this kind stands for stand as a picture of the kind of the places of a picture of the
engine itself, so the reference walks the picture **twice**: once over a walk of the places of a picture of a
kind of its own, to stand the words of the head of the picture of the engine and read how wide and how tall it
stands, and then a second time over the places the walk of the picture stands for, standing the picture of the
kind of the places of a picture of the engine out of them. A picture of the first kind of the walk names no
places of the walk of it, and the reference stands the places the walk of the picture stands for from the words
of the head of the picture of the engine — the words of the head of a picture of the kind of the places of a
picture of the engine and the places of it. This port stands the picture the same way.

## What stands covered by a fixture and what does not

The walk of the places of a picture stands covered by a fixture of this project: the places of the walk of a
picture that stand for places of the picture of their own (of four places and of eight, with the words of the
walk of the picture standing before the places of the picture of them), and the places of the walk of a picture
that name the places behind them and the counts of them — that is, the walks whose places of the picture stand
as the places of the picture of two places of the picture of their own standing over and over, of the counts of
three places to sixteen. These stand against an account of the reference of its own
(`tests/formats/advsys-pola-image.test.ts`).

The places of the walk of a picture that stand **uncovered** stand as:

- the counts of the places of the walk of the count of its own of five and twenty places or more, which stand as
  the places of the count of a place of the picture of its own;
- the places of the walk of a picture that stand further behind the place written than the places of the walk of
  the kind of the count of its own.

What a game stands in the places of a picture of this kind therefore stands to be stood against the walks of
the reference, where a walk of the picture stands for a count of the places of a walk of five and twenty places
or more or for the places of a picture of a walk of the kind of the count of the places behind it.

## Deviations from the reference

- The reference stands the words `*Pola*` in the places of its own words of a picture of this kind; the words
  it reads stand in five places and the words of the kind of the walk of a picture stand behind them.
- A walk that stands past the places of the picture, of a walk of the places of a picture of a kind of its own,
  or of the file stands refused with a `GarbroError`; the reference would stand the places of a picture of a
  kind of its own or stand a word of the kind of the places of a picture.
- A picture whose walk stands for no picture of the engine stands refused.

## Tests

`tests/formats/advsys-pola-image.test.ts` covers the head of a picture of each of the two kinds of the walk of
its places, the heads it is turned away for, the walk of a picture whose places of the walk stand for places of
the picture of their own (of eight places and of four), a walk that stands short of the places of the picture,
and the words the picture is told by.
