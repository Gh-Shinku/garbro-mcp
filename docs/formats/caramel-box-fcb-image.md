# Caramel BOX image format

places of a picture of `FcbFormat`. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/caramel-box/fcb-image.ts` (`caramelBoxFcbImageDescriptor`,
`caramelBoxFcbImageFormat`, id `caramel-box-fcb-image`, `readFcbLayout`, `readFcbPlaces`,
`unpackFcbPicture`). The archive of the same engine stands in `packages/formats/src/caramel-box/arc4.ts`, and
`packages/codecs/src/tz.ts` (moved out of `arc4.ts`, which stands on them as well).

places of a picture of the four places of a place of the picture either way:

- **the kind of the compression of the pictures of the engine**: the words of the head of the picture name the
  of the kind a picture of the words of the file stands in;

grey, of the four places of a place of the picture standing whole.

## Deviations from the reference

  stands refused with a `GarbroError`; the reference stands such a picture away with a word of its own.
- A picture of no places stands nowhere and is refused.

## Tests

`tests/formats/caramel-box-fcb-image.test.ts` covers the head of a picture of each of the two kinds of the walk
