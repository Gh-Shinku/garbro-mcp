# F&C Co. engine image (`MCG`)

* Reference: `GARbro/ArcFormats/FC01/ImageMCG.cs` (`McgFormat`, `McgDecoder`), GARbro commit
  `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT.
* Port: `packages/formats/src/fc01/mcg-image.ts` (`fc01McgImageFormat`, id `fc01-mcg-image`); the walk of the
  words of it stands in `packages/formats/src/fc01/mrg-decoder.ts` (`MrgDecoder`), which the two MRG
  archives of the same engine stand of as well.
* Tests: `tests/formats/fc01-mcg-image.test.ts`.

## Layout

The file opens with the words `MCG `, the count of the places of the hundred of the version of the engine at
4, the point of the version of it at 5 and the counts of the tens and the ones of it at 6 and 7: the version
stands of `hundreds*100 + tens*10 + ones - 0x14D0`, of 2.00, 1.01 and 1.00 of them. The places of the head
of the walk of the words of the picture stand at `0x10` (of which the places of the walk of the places of
the file of it stand, of the places of the file of the head of the picture behind), the places X and Y of the
picture at `0x14` and `0x18`, the width and the height of it at `0x1C` and `0x20`, the count of the places
of a colour of it at `0x24` (twenty four, sixteen or eight), the count of the channels of it at `0x34` and
the place of the end of the walk of the places of the file of it at `0x38` (of the count of the places of
the file of the picture where it stands of nought).

The places of the colour map of a picture of eight places to a place stand at the place of the head of the
walk of the places of the file of it, of `0x100` words of four places of the file each; the masks of the
channels of a picture of sixteen places to a place stand there as well, of the count of the channels of the
picture, of four places of the file to a mask. The walk of the places of the file of the picture stands
behind them.

## The walk of the places of the file of a picture of the version 2.00

Three walks of the places of the file stand of the `MrgDecoder` codec of the engine, of the count of the
places of the picture of the head of the walk of each of them: the green of the places of the picture, its
blue and its red. The password of the walk of them stands of the count of the places of the file of the
counts of the table of the codec, of nought of the places of the file of the head of the walk of each of
them; the reference tries the passwords of the medium of the picture one behind another where the walk of
them stands of no count of the places of the file.

The places of the picture behind the walks of them stand of the places of the rows of the file of it: of the
place of the file behind the place of it, of the count of the places of the three places of a place of them,
and of the count of the places of the file of the blue and the red of the place of it of the green of it.

## Deviations

* **A picture of a version behind 2.00.** The places of the file of it stand of the password of the picture,
  which the reference asks the medium of the engine for (`McgScheme.KnownKeys` and the widget of it) rather
  than reading out of the picture; the walk of the places of the file of them is refused with
  `UNSUPPORTED_FEATURE`. The head of such a picture stands of the walk of the words of it as well.
* **A picture of the version 2.00 of a count of the places of a colour of its own.** The walk of the places
  of the file of the engine stands of the three places of a place of the picture of every picture: the
  reference stands of a buffer of the count of the places of the walk of the codec of the picture whatever
  its count of the places of a colour stands of, of a picture of eight or sixteen places to a place behind
  it; the port refuses it with `UNSUPPORTED_FEATURE`.
* **A picture of the places of the file of the walk of the codec of it of the count of the picture alone.**
  Refused with `INVALID_ARCHIVE`; the reference stands of the places of the file behind the walk.
* **A password of the picture standing of none of the passwords of the engine.** Refused with
  `UNSUPPORTED_FEATURE`; the reference throws `UnknownEncryptionScheme` where the password of the medium of
  the picture stands of no walk of the places of the file. The port stands of the passwords of the places of
  the file of the engine of `0` to `0xFF`, of no password of the medium of the picture (which the reference
  stands of).
* **Packing a picture.** The reference stands of a format of its own, standing of no packer.
