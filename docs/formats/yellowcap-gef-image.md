# YellowCap GEF image

Reference: `GARbro/Legacy/YellowCap/ImageGEF.cs`, class `GefFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/yellowcap/gef-image.ts` (`gefImageDescriptor`, `gefImageFormat`,
id `yellowcap-gef-image`).

An **embedded PNG behind a twelve byte header**. The reference reads sixteen bytes, but the first four of
those are the beginning of the PNG itself: its own data is the signature word, a copy of the width and a
copy of the height, and the embedded stream starts at **0xC** with the PNG signature.

| field | offset |
|---|---|
| signature (`0x00010100` or `0xFF010100`) | 0 |
| width (u32) | 4 |
| height (u32) | 8 |
| embedded PNG, signature included | 0xC |

The reference lists two signatures, the second setting the top byte — a variant flag rather than a
different layout. Both are registered and accepted.

The port exposes the resource as a single entry:

* detection matches either signature, requires the PNG signature at 0xC, checks the IHDR length and tag,
  rejects zero dimensions, and — as the reference does — requires the embedded PNG's width and height to
  **agree with the header's own copy**. A file whose two copies disagree is declined;
* the entry is named after the source file with a `png` extension, covers everything from 0xC to the end of
  the file and, since the embedded stream is the PNG itself, sets `sizeKnown: true`: the listed size really
  is the extracted size;
* extraction is a straight copy — no byte of the PNG is rewritten, which the test asserts by comparing the
  output with the input PNG byte for byte, and by checking that the sixteen byte header is absent;
* entry metadata carries `type: "image"` with the dimensions and bits per pixel, and the archive metadata
  records `image: "png"`, the dimensions, bit depth, colour type, channel count and bits per pixel.

The PNG colour-type to channel-count mapping is now duplicated in three ports (`psm-image`,
`misc-pnx-image` and this one); a shared PNG metadata helper would be a worthwhile follow-up in its own
commit.

Encoding and archive creation are out of scope.
