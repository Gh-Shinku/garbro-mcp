# EAGLS compressed bitmap

Reference: `GARbro/ArcFormats/Eagls/ImageGR.cs`, classes `GrFormat` and `GrMetaData` (EAGLS system
compressed bitmap). GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/eagls/gr-image.ts` (`eaglsGrImageDescriptor`, `eaglsGrImageFormat`, id
`eagls-gr-image`, `readGrLayout`).

The format has **no signature of its own**: the reference registers it with a signature of zero and no
extensions, so it is offered every file the other formats leave. What it holds is a **bitmap inside a run
length stream**, and the two bytes `BM` of the bitmap it unfolds to are the only word it has.

## The picture

The measurements come out of the first thirty eight bytes of the unfolded stream, which is as much as the
reference unfolds to read them:

| Offset | Meaning                                          |
| ------ | ------------------------------------------------ |
| 2      | the length of the bitmap, a long                 |
| 0x12   | the width, a long                                |
| 0x16   | the height, a long                               |
| 0x1C   | the depth, a word                                |
| 0x22   | the length of the pixels, a long, zero if unset  |

A stream that unfolds to fewer bytes than that, or to something that does not open with `BM`, is not one this
format claims. The depth of zero pixels is filled in from the measurements, and the length the reference
records for the whole picture is the length of the bitmap when the depth is twenty four bits and the length of
the pixels plus the fifty four bytes of a bitmap header otherwise.

## Reading it back

A picture of twenty four bits — and any other depth but thirty two — is handed straight to the bitmap reader,
which is what the reference does with the bitmap it unfolds. A picture of **thirty two** bits is stored the
way a bitmap stores its rows, from the bottom up, and the reference hands its pixels out the other way up: it
keeps the header of the bitmap, reads the rows back into a picture that runs the other way, and asks for a
picture of four bytes to a pixel.

Two deviations are deliberate. The reference leaves the fifty four bytes of the bitmap header **in front of**
its pixel array and hands the whole thing out as the pixels of the picture, which leaves the picture off by
that much; its own comment says it means to skip the header, and the port does. And where the reference
unfolds the stream a byte at a time as it reads, the port unfolds it in one go, with a limit of 256 MB behind
it, because the length a bitmap behind it needs is only known once its header has been read.

Nothing here writes the format: `GrFormat.Write` is not implemented in the reference either. A picture of no
width or no height is refused with `UNSUPPORTED_FEATURE`, one that unfolds past the limit with
`LIMIT_EXCEEDED`, and a stream that unfolds to something other than a whole bitmap, or short of the pixels it
declares, with `INVALID_ARCHIVE`.

The tests cover the two bytes the format is found by, the measurements and the name of the entry, a picture of
twenty four bits, one of thirty two whose rows are turned the right way up, one with a colour map, a stream
that unfolds to something other than a bitmap, one whose pixels are cut short, and a picture of nothing.
