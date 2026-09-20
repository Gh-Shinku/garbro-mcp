# RPG Maker engine resource archive

Reference: `GARbro/Experimental/RPGMaker/ArcRGSS.cs`, classes `RgssOpener`, `RgssEntry` and `KeyGenerator`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/rpg-maker/rgss-ad.ts` (`rpgMakerRgssAdDescriptor`,
`rpgMakerRgssAdFormat`, id `rpg-maker-rgss-ad`, `readRgssLayout`, `RgssKeyGenerator`, `decryptRgssPlaces`,
`encryptRgssPlaces`), with the fixed entry helpers of `packages/formats/src/shared/fixed-archive.ts`.

The reference registers the word `RGSS` and the names `rgssad`, `rgss2a` and `rgss3a`.

## The head

The word `RGSS` stands at the beginning of the file with the word `AD` and a place of nothing behind it, and
the third kind and no other, so a file of another kind is left to the kinds that read it otherwise.

## The walk of the keys

Every key of a walk of the first kind stands as the key before it stood, seven times over, three places beside
word at `0x08` of the file, nine times over, three places beside it.

## The walk of the files of the first kind

of the walk standing under one key of it, and every place of a name stands under the lowest place of one key of
the walk. The key every file stands under is the key the walk stands at after the walk named how many places
the file holds.

## The walk of the files of the third kind

The walk stands as a walk of its own at the front of the file, four places apiece for every file: where the
name of the file stands in, with the name behind them. Every place of the walk stands under the key of the
and over. Four places of nothing stand where the walk ends, so a place of nought once the key stands out of it
ends the walk.

## The places of a file

Every four places of a file stand under the four places of one key, and the key behind them stands as the next
named for it.

## Deviations from the reference

- A file of fewer than eight places, a file that does not hold the words of the format, a file whose place at
  `0x07` names no walk the reference reads, a walk that names as many files as this project stands as mad, a
  name that does not stand as the name of a file, and a file that stands outside the archive are turned away;
  the reference would throw while reading the walk, or would hand out a walk it read under the wrong key.
- The walk of the first kind ends where the file ends, and a walk that stops in the middle of a file of the
- The places of a file stand in the clear as they stand, which is what the reference hands out.

## Tests

`tests/formats/rpg-maker-rgss-ad.test.ts` covers the keys of a walk and the places a key stands in, the walk
whose head does not hold its own words, a file of a kind the reference does not read, a walk whose file stands
outside the archive, the files of an archive of either kind stood in the clear, and the finding of an archive
of its own kind. Both archives of the test stand worked out with walks of the keys of their own, so their
places stand under walks this port did not work out.
