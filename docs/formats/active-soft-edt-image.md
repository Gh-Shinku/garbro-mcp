# Active Soft RGB image format

Reference: `GARbro/ArcFormats/ActiveSoft/ImageEDT.cs`, classes `EdtFormat`, `EdtMetaData`, `BitReader` and
`EdtFormat.Reader`. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/active-soft/edt-image.ts` (`activeSoftEdtImageDescriptor`,
`activeSoftEdtImageFormat`, id `active-soft-edt-image`, `readEdtLayout`, `unpackEdtPicture`) over the walk of
the places of a picture of the engine in `packages/formats/src/active-soft/ed-common.ts` (`EdBitReader`), which
the indexed pictures of the same engine (`ED8`) stand on as well.

## The head

The words `.TRUE` stand in the first places of the file behind the places of a picture of the kind of the words
of the engine, and behind them stand how wide and how tall the picture stands, how many places the walk of the
places of the picture stands for, and how many places the picture of the places of the walk of the picture of
its own stands for — the last standing as the places of a picture of the three places of a place of the picture,
so the reference stands a picture whose places of the picture of the walk of it stand for no place of the
picture of a place of the picture away.

## The walk

The places of the walk of a picture of the engine stand in the places of the picture of the walk of them, the
first place of the walk of a picture standing in the place behind the first place of the picture of the walk of
it, and the places of the picture stand beside them. Every place of the walk names one of three kinds:

- **a place of the picture that stands as a place of the picture of the places behind the places of the walk of
  the picture of its own**, the count of the places it stands for standing as the places of the walk of the
  count of its own;
- **a place of the picture that stands as the places of the picture of the place beside it** — the reference
  stands the place behind the place written where a place of the walk of a picture of the kinds of the walk of
  the places of the picture stands clear, and one of four kinds of the places of the picture of the walk of the
  count of the places of the picture where it stands — with the places of the picture standing within the
  places of the picture of the places of the picture behind it, of the kinds of the walk of the places of the
  picture of the count of them (of the places of the picture of the places of the picture behind them and of a
  place of the picture of its own);
- **a place of the picture of the words of the walk of it**, which stand as the places of the picture of the
  walk of the picture of its own.

The four kinds of the places of the picture of the walk of the count of the places of the picture stand packed
within the words `0x11191718` of the reference, which stand as the places of the picture of the kinds of the
walk of the places of the picture of the count of the places of the walk of the picture of the two places of
theirs: a place of the picture of the row above the place written, at the place of the picture of the places
beside it, and the places of the picture of the two rows above the place written.

## Deviations from the reference

- The reference stands the walk of the places of the picture away where the places of the picture of the walk of
  it stand before the places of the picture itself, standing the places of the picture behind them clear; this
  port stands the walk away the same way, standing the places of the picture of the walk of it as the reference
  stands them.
- The reference reads the words of the head of a picture of this kind without standing them against the places
  of the file; this port stands them against the places of the file, so a picture cut short of the places of the
  picture stands away.
- A walk of the places of a picture that stands past the places of the picture, and a walk whose places of the
  picture of the walk of it stand short of the places of the picture, stand refused with a `GarbroError`.
- A picture of no places stands nowhere and is refused.

## Tests

`tests/formats/active-soft-edt-image.test.ts` covers the head of a picture, the heads it is turned away for,
the places of the pictures of the test — a picture whose places stand as the places of the picture of the words
of the walk of them, a picture whose places of a row stand as the places of the picture of the row before them,
and a picture whose places stand of the places of the picture beside them — the places of a picture stood out as
a picture of the three places of a place of the picture, a picture cut short of the places of the walk of it,
and the words of the head the picture is told by. The places of the pictures of the test stand against an
account of the reference of its own that stands the pictures of the test from the words of their heads.
