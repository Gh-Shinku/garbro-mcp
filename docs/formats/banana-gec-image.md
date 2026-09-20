# Yellow Pig image format (`GEC`)

Reference: GARbro `ArcFormats/Banana/ImageGEC.cs`, classes `GecFormat`, `GecMetaData` and `GecReader`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## Head

| place | word |
| --- | --- |
| 5 | how wide the picture stands (u16) |
| 7 | how tall the picture stands (u16) |

| place | word |
| --- | --- |
| 0x17 | how tall they stand |

of them.

their own.

## Deviations from the reference

The walk stands as the reference stands it, with three differences, all of them where the reference reads or

  them;

## Verification

picture: an independent transcription of `GecReader.UnpackFrame1` and `GecReader.UnpackFrame2` in Python,
