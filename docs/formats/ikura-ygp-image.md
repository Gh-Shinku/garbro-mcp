# Ikura GDL image format

Reference: `GARbro/ArcFormats/Ikura/ImageYGP.cs`, classes `YgpFormat` and `YgpMetaData`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/ikura/ygp-image.ts` (`ikuraYgpImageDescriptor`, `ikuraYgpImageFormat`, id
`ikura-ygp-image`, `readYgpLayout`, `unpackYgp`).

The signature word the reference declares is `0x504759`, the letters `YGP` with a nothing in the last byte, and
it declares no extensions. The header begins with two bytes the reference reads and never looks at again:

| offset | what it holds |
| --- | --- |
| `0x04` | two bytes the reference reads and never uses |
| `0x06` | the kind of the picture, which has to stand at one or two |
| `0x07` | the flags: the lowest says the pixels are walked, the one worth four that a place is kept |
| `0x08` | the length of the header, which is also where the fields below stand |

At the length of the header stand the size of the stream of the pixels, then the width and the height; the
place the picture stands at stands at `0x14` and is read only when the flag for it is set, and it is reported
as the file holds it. The depth is always reported as thirty two bits, whatever the file says. A file whose
header does not hold those fields, or whose picture has no width or height, is turned away rather than throwing
the way the reference's own reader would.

The pixels of a picture whose flag for walking is clear stand in the stream as they are, four bytes to the
pixel and the top row first; a stream shorter than the picture leaves the rest of it as it stands. A picture
whose flag for walking is set is read a step at a time, the walk bounded by the size the header gives:

| control | what it does |
| --- | --- |
| below `0x40` | that many pixels plus one stand in the stream themselves |
| `0x40` to `0x7F` | that many pixels plus one repeat the pixel before the run |
| `0x80` to `0x9F` | the same, copied from a place behind that a byte holds, counted in pixels |
| `0xA0` to `0xBF` | the same, with a place two bytes long |
| `0xC0` and above | nothing: the rest of the stream is stepped over without the picture moving on |

The last kind is what a stream that has run out reads as, since the reference reads a byte past its end as
nothing at all, so a stream whose size runs past the end of the file steps over the rest of its count without
writing anything more. A step of pixels that stand in the stream itself reads as many as the file still holds,
leaving the rest of the pixels it asked for as they stand. A step that would write past the end of the picture
is refused, and so is a copy whose place reaches before the start of the picture, where the reference's own
writer would throw.

The reference's write path throws `NotImplementedException`, so this is a read only format, and a picture whose
pixels would take more than 256 megabytes is refused at extraction.

The tests cover the four letters of the signature, the declines of a picture of a kind other than one or two,
of one of no width or height and of one whose header does not hold the fields behind it, the two bytes the
reference never looks at again, the measurements, the depth and the place where the flag asks for it and its
absence where it does not, the pixels of a picture that stands in the stream as they are, a walk of pixels that
stand in the stream, a step repeating the pixel before it, a copy from a place a byte long and one from a place
two bytes long, the step over the rest of the stream that moves the picture on by nothing, the pixels a short
step leaves as they stand, the refusals of a walk past the end of the picture and of a copy from before its
start, a picture too large to hold, and the walk of a picture of one pixel.
