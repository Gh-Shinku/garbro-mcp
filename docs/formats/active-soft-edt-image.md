# Active Soft RGB image format

Reference: `GARbro/ArcFormats/ActiveSoft/ImageEDT.cs`, classes `EdtFormat`, `EdtMetaData`, `BitReader` and
`EdtFormat.Reader`. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/active-soft/edt-image.ts` (`activeSoftEdtImageDescriptor`,
`activeSoftEdtImageFormat`, id `active-soft-edt-image`, `readEdtLayout`, `unpackEdtPicture`) over the walk of
the indexed pictures of the same engine (`ED8`) stand on as well.

## The head

picture of a place of the picture away.

## The walk

first place of the walk of a picture standing in the place behind the first place of the picture of the walk of

  count of its own;
  stands the place behind the place written where a place of the walk of a picture of the kinds of the walk of
  place of the picture of its own);
  walk of the picture of its own.

## Deviations from the reference

  stands them.
  picture stands away.
- A picture of no places stands nowhere and is refused.

## Tests

`tests/formats/active-soft-edt-image.test.ts` covers the head of a picture, the heads it is turned away for,
account of the reference of its own that stands the pictures of the test from the words of their heads.
