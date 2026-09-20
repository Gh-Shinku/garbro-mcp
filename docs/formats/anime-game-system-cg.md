# Anime Game System image format

Reference: `GARbro/ArcFormats/AnimeGameSystem/ImageAinos.cs`, classes `CgFormat`, `CgMetaData` and
`CgFormat.Reader`. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/anime-game-system/cg-image.ts` (`animeGameSystemCgImageDescriptor`,
`animeGameSystemCgImageFormat`, id `anime-game-system-cg`, `readCgLayout`, `unpackCgPicture`). The archive of
the same engine stands in `packages/formats/src/anime-game-system/dat.ts` and the pictures of its other kind in
`packages/formats/src/anime-game-system/ani.ts`.

## The head

## Deviations from the reference

  a `GarbroError`.
- A picture of no places stands nowhere and is refused, and a picture whose words of the head stand past the
  picture of the engine, and this port stands them there as well.

## Tests

the test (a picture of the whole of a picture, a picture of a part of a picture standing within it, and a
account of the reference of its own that stands the pictures of the test from the words of their heads.
