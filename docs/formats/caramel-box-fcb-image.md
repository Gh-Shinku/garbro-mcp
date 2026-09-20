# Caramel BOX image format

Reference: `GARbro/ArcFormats/CaramelBox/ImageFCB.cs`, classes `FcbFormat`, `FcbMetaData` and the walk of the
places of a picture of `FcbFormat`. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/caramel-box/fcb-image.ts` (`caramelBoxFcbImageDescriptor`,
`caramelBoxFcbImageFormat`, id `caramel-box-fcb-image`, `readFcbLayout`, `readFcbPlaces`,
`unpackFcbPicture`). The archive of the same engine stands in `packages/formats/src/caramel-box/arc4.ts`, and
the places of the walk of a picture of the kind of the compression of the pictures of the engine stand in
`packages/codecs/src/tz.ts` (moved out of `arc4.ts`, which stands on them as well).

## The head and the two kinds of the walk of the places of a picture

The words `fcb1` stand in the first places of the file, and behind them stand how wide and how tall the picture
stands and the kind of the walk of the places of the picture. The places of a picture of this kind stand in the
places of a picture of the four places of a place of the picture either way:

- **the kind of the compression of the pictures of the engine**: the words of the head of the picture name the
  places of the walk of the places of the picture four places behind the words of the head of it, the places of
  the picture of the two words of the places of the picture of the engine standing behind them (the places of
  the walk of the picture standing of the places of the picture of the kind of the engine of the big-endian
  places of the picture), and the places of the walk of them standing as a stream of the places of the picture
  of the kind a picture of the words of the file stands in;
- **the kind of the places of a picture of a picture of the engine**: the places of the walk of the places of
  the picture stand as the places of the picture of the compression of the pictures of the engine, which stand
  in the places of the picture of the engine of the same kind (`TzCompression`).

## The walk of the places of a picture

The places of the picture stand as the places of the picture of the differences of them from the places of the
picture beside them and from the places of the picture of the row above them, the places of the picture of a row
standing from the places of the picture of the first place of the row, which the places of the picture of the
row behind it stand from as well. The places of the picture of the background of a picture of this kind stand
grey, of the four places of a place of the picture standing whole.

Every place of the picture stands as one of six kinds of the places of the picture of the differences of the
places of the picture, told by the places of the picture of the word of the walk of the places of the picture:
the kinds of the places of the picture of the three places of the picture (of the places of the picture of the
differences of the five places of the picture of the walk of them) standing as the shortest words of the walk of
the places of the picture, and the kinds of the places of the picture of the four places of the picture (of the
places of the picture of the four places of the walk of them, the places of the picture of the differences of
the places of the picture of the walk of them standing as the places of the picture of the word of the walk of
the places of the picture and of the places of the picture behind it) standing as the longest ones. The three
places of the picture of the differences of a place of the picture stand within the places of a picture of the
places of the picture beside them: the places of the picture stand as the places of the picture of the
differences of the places of the picture of the three places of the picture of the walk of the places of the
picture of the places of the picture of the kinds of the places of the picture of the engine — of the places of
the picture of the places of the picture behind the places of the walk of the picture of the kind of the places
of the picture of the four places of the picture, the places of the picture of the walk of the places of the
picture of the kind of the places of the picture of the three places of the picture standing for the places of
the picture of the walk of them.

## Deviations from the reference

- The reference reads the places of the walk of the places of a picture of the kind of the compression of the
  pictures of the engine without standing the words of the head of the picture that name the places of the walk
  of the picture against the places of the walk of them; this port stands the places of the walk of the picture
  of the kind of the places of a picture of the engine the same way, and stands the words of the head of the
  picture against the places of the file, so a picture cut short of the places of the walk of it stands away.
- A picture of a kind of the walk of the places of the picture the reference stands no places of the picture for
  stands refused with a `GarbroError`; the reference stands such a picture away with a word of its own.
- A walk of the places of a picture that stands short of the places of the picture stands refused as well, where
  the reference would stand the places of the picture of the places of the picture of a kind of the engine.
- A picture of no places stands nowhere and is refused.

## Tests

`tests/formats/caramel-box-fcb-image.test.ts` covers the head of a picture of each of the two kinds of the walk
of its places, the heads it is turned away for, the places of the picture stood out of the places of the walk of
the picture of the kind of the compression of the pictures of the engine and of the kind of the places of a
picture of a picture of the engine (the places of the picture of the test standing against the places of the
picture of the differences of them standing from the places of the picture of the first place of every row), a
picture of a kind of the walk of the places of the picture the port stands no places of the picture for, a
picture whose places of the walk stand short of the places of it, and the words of the picture it is told by.
