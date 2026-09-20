# AZ system image format

Reference: `GARbro/ArcFormats/AZSys/ImageCPB.cs`, classes `CpbFormat`, `CpbMetaData` and `CpbFormat.Reader`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/azsys/cpb-image.ts` (`azsysCpbImageDescriptor`, `azsysCpbImageFormat`,
id `azsys-cpb-image`, `readCpbLayout`, `decompressCpbChannel`, `unpackCpbPicture`).

## The head

The words `CPB\x1a` stand in the first places of the file, and behind them stand the kind of the picture, how
many places a place of it stands in (four and twenty or two and thirty), the kind of the walk of the places of
it, how wide and how tall it stands, and how many places every record of the places of it stands for. The words
behind those stand in the order of the kind of the walk of the picture: the kind of the walk of a picture of
the second kind stands the places of a picture of its own behind the places of the words of the head of the
picture, so the places of the pictures of the two kinds stand in kinds of their own. The places of the picture
stand in thirty-two places of the head either way — four words of the kind of the picture, how wide and how
tall it stands, and four records of the places of a picture.

## The places of the picture

The places of a picture of this kind stand as four records of the places of a picture, and the places of the
records stand beside each other in the places of the picture: every record stands for one place of every place
of the picture. Which record stands for which place of a picture stands as two tables of the kind of the walk
of the picture, the first table standing which record of the places of the file a record of the picture stands
as and the second standing which place of a picture it stands for. The records of the places of a picture of
the third kind of the walk, and of the first kind, stand in kinds of their own:

- **The third kind** stands as one stream of the kind the places of a picture stand in (a walk of its own, see
  below).
- **The first kind** stands as a stream of the places of a picture of the kind a picture of the words of the
  file stands in, standing behind four places that stand for the places of a picture itself rather than for
  the places of the picture.

A record that stands for no places of the picture stands nowhere in the file, and the places of the picture it
stands for stand as the places of the picture stand them — the reference stands the records of a picture one
after another without standing anything for a record of no places.

## The walk of a record of the third kind

A record of the third kind stands behind the words of the head of the walk of it in twenty places: how many
places the record stands for, where the words of the walk of a picture stand, and where the places that stand
for themselves stand. The words of the walk of a picture stand for eight places of the walk each: a place of
the walk that stands names a place of the picture that stands **behind** the place of the picture being
written, of three places or more of the picture, and a place of the walk that stands clear names a run of
places of the picture that stand for themselves, of the places behind the walk. The places of a picture of a
walk of this kind stand beside one another, so a walk of places that stands within the places it stands for
stands as a walk of the places written a moment ago — this port stands them the same way.

## Deviations from the reference

- The reference stands a picture of eight places as places of a picture of the kind of a palette, but reads no
  words of the head for such a picture — the words of the head of a picture of a kind stand as a picture of
  four and twenty places or of two and thirty places. This port refuses a picture of eight places where the
  reference stands it away with a word of its own.
- The reference stands a picture whose walk names no kind of its own away with a word of its own; this port
  refuses it as it refuses the words of the head.
- A walk that stands past the places of a record, of the picture, or of the file stands refused with a
  `GarbroError`; the reference would stand the places of the picture past the record, or stand a word of the
  kind of the places of a picture.
- The reference hands the places of a picture of four and twenty places out in four places for every place of
  the picture, the places behind them standing clear; this port stands them in a picture of four places the
  same way, so a picture of four and twenty places stands as a picture of two and thirty places.

## Tests

`tests/formats/azsys-cpb-image.test.ts` covers the head of a picture of each of the two kinds of the walk of
its places, the heads it is turned away for, a record of the walk of the third kind standing for places of its
own and for the places written a moment ago (which stand within the places they stand for), a record that
stands for more places than the picture, the places of the four records of a picture standing beside each
other, a picture of the first kind stood out as a picture of four places, a record of the second kind stood out
of a stream of the places of a picture, and the words the picture is told by.
