# Anime Game System image format

Reference: `GARbro/ArcFormats/AnimeGameSystem/ImageAinos.cs`, classes `CgFormat`, `CgMetaData` and
`CgFormat.Reader`. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/anime-game-system/cg-image.ts` (`animeGameSystemCgImageDescriptor`,
`animeGameSystemCgImageFormat`, id `anime-game-system-cg`, `readCgLayout`, `unpackCgPicture`). The archive of
the same engine stands in `packages/formats/src/anime-game-system/dat.ts` and the pictures of its other kind in
`packages/formats/src/anime-game-system/ani.ts`.

## The head

Five places: the kind of the picture (which the reference stands beneath the places of a picture of the kind of
the places of a picture of the engine), how wide and how tall the picture stands, the places of each standing in
two places. Where the kind names a part of a picture — the places of the kind of the walk of the places of a
picture stand in the three places behind the places of the picture of the kind, which the reference tells by the
places of the kind itself — eight further places name the places of the picture of the part of the picture that
stands *within* the picture: the places of the head of the part standing in the places behind the five places of
the head of the picture. The reference stands a picture whose places of the picture of the part of it stand
beside each other outside the picture, or which names no places of the picture of the picture at all, away.

## The places of the picture

The picture stands as a part of a picture rather than as the whole of one: only the places of the picture of the
part that the words of the head name stand, and the places behind them — the places of the picture of the whole
of a picture that the part stands for no place of — stand as the places of the picture of the background of a
picture of this kind, which stand green. The reference stands the places of such a picture from the places of
the walk of the places of the picture of the kind of the picture, of which there stand two:

- **The kind of the places of a palette of its own**: the places of the walk of the picture stand for the
  places of the picture of the places of a palette of a hundred and eight and twenty places of three places
  each, which stands behind the words of the head of the picture and before the places of the walk of it.
- **The kind of the places of a picture of its own**: the places of the picture stand as the places of the
  picture of the places behind them or as the places of the picture of the words behind the places of the walk
  of them, which stand as the places of the picture of the three places of a place of the picture, the places of
  the picture of a place of the walk standing as the places of the picture of the places of the picture behind
  the place written (the places of the walk of the kind of the places of the picture of the engine).

Both kinds of the walk of the places of a picture stand as places of the walk of the count of the places it
stands for and of the place of the picture of the places beside the place written, the count of the places of a
walk standing in the places of the walk of the places of the picture of the count of its own where the places of
the walk of the count stand for the places of the picture of no place of their own.

## Deviations from the reference

- The reference reads the places of a picture of this kind through helpers that stand the places of the picture
  within an array and stand a picture away with a word of the kind of the places of a picture; this port refuses
  a walk that stands past the places of the part of the picture, a picture cut short of the places of the walk
  of it, and a picture whose places of the head stand short of the words of it, standing each of them away with
  a `GarbroError`.
- A picture of no places stands nowhere and is refused, and a picture whose words of the head stand past the
  places of the picture of a kind stand refused as well.
- The words a picture of this kind names itself with stand in no places of the picture: the reference stands the
  pictures of the kinds it names no places of the head for behind the pictures of the kinds of the places of a
  picture of the engine, and this port stands them there as well.

## Tests

`tests/formats/anime-game-system-cg.test.ts` covers the head of a picture of a kind of the places of a picture
of a part of it and of one of the whole of it, the heads it is turned away for, the places of the pictures of
the test (a picture of the whole of a picture, a picture of a part of a picture standing within it, and a
picture of a kind of the places of a picture of its own), a picture cut short of the places of the walk of it,
and the words of the head the picture is told by. The places of the pictures of the test stand against an
account of the reference of its own that stands the pictures of the test from the words of their heads.
