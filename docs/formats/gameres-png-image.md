# Portable Network Graphics image (`PNG`)

* Reference: `GARbro/GameRes/ImagePNG.cs` (`PngFormat`)
* Port: `packages/formats/src/gameres/png-image.ts`, record `gameres-png-image`
* Tests: `tests/formats/gameres-png-image.test.ts`

## Layout

Eight bytes of signature stand at the head of the file, then a chunk of the head of the picture (`IHDR`):
the width and the height of it of four places each, the count of the places of a place of the file (1, 2, 4,
8 or 16), the colour of it, and the places behind them. The places of a place of the picture stand of the
colours of the picture: of the count itself for the places of one colour, of the count times three for the
colours of a picture, of twenty four places for the colours of a colour map of the picture, of the count
times two for the places of one colour and the alpha behind them, and of the count times four for the
colours and the alpha behind them.

The chunks of the file behind the head are walked to the places of the picture itself: a chunk of the place
of the picture in the picture it stands of (`oFFs`, two counts of four places and a place naming the places
of them, of no place) names the place of the picture.

## The places of the picture

The places of the picture stand of the reader of the project (`packages/formats/src/shared/png-image.ts`),
which stands of the five walks of the places of a picture of the kinds of the reference and of the places of
a picture of four places to a byte, and which hands a picture over of the blue of a colour first. The port
hands the places of the picture over as a bitmap of that count of places.

## Deviations

* **A picture standing of the places of another picture** (the walk of two places of a picture of seven
  places to a byte). Refused with `UNSUPPORTED_FEATURE`; the reference stands of the reader of the pictures
  of a system of its own, which reads them.
* **Writing a picture.** The reference writes a portable network graphic and the chunk of the place of a
  picture in it; the port reads alone.
