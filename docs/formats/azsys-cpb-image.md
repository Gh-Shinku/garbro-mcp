# AZ system image format

Reference: `GARbro/ArcFormats/AZSys/ImageCPB.cs`, classes `CpbFormat`, `CpbMetaData` and `CpbFormat.Reader`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/azsys/cpb-image.ts` (`azsysCpbImageDescriptor`, `azsysCpbImageFormat`,
id `azsys-cpb-image`, `readCpbLayout`, `decompressCpbChannel`, `unpackCpbPicture`).

## The head

of the picture. Which record stands for which place of a picture stands as two tables of the kind of the walk
the third kind of the walk, and of the first kind, stand in kinds of their own:

  below).

after another without standing anything for a record of no places.

## The walk of a record of the third kind

A record of the third kind stands behind the words of the head of the walk of it in twenty places: how many
places the record stands for, where the words of the walk of a picture stand, and where the places that stand
the walk that stands names a place of the picture that stands **behind** the place of the picture being
written, of three places or more of the picture, and a place of the walk that stands clear names a run of

## Deviations from the reference

- The reference stands a picture of eight places as places of a picture of the kind of a palette, but reads no
  words of the head for such a picture — the words of the head of a picture of a kind stand as a picture of
  four and twenty places or of two and thirty places. This port refuses a picture of eight places where the
  reference stands it away with a word of its own.
- The reference stands a picture whose walk names no kind of its own away with a word of its own; this port
  refuses it as it refuses the words of the head.
  the picture, the places behind them standing clear; this port stands them in a picture of four places the
  same way, so a picture of four and twenty places stands as a picture of two and thirty places.

## Tests

`tests/formats/azsys-cpb-image.test.ts` covers the head of a picture of each of the two kinds of the walk of
own and for the places written a moment ago (which stand within the places they stand for), a record that
other, a picture of the first kind stood out as a picture of four places, a record of the second kind stood out
