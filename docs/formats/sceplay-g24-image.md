# Sceplayer image formats

Reference: `GARbro/Legacy/Sceplay/ImageG24.cs`, classes `G24AFormat`, `G2408Format`, `G24MetaData` and
`G24Reader`. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/sceplay/g24-image.ts` — `sceplayG24aImageDescriptor` /
`sceplayG24aImageFormat` (id `sceplay-g24a-image`) and `sceplayG2408ImageDescriptor` /
`sceplayG2408ImageFormat` (id `sceplay-g2408-image`), with `readG24aLayout`, `readG2408Layout`, `unpackG24`,
`unpackG24Rle`, `applyG24ColorDelta` and `applyG2408Delta`.

## The two heads

The twenty four bit picture begins with the mark `g24a`, its width and its height stand at eight and twelve
as words, and its stream at `0x2C`. The eight bit one begins with the mark `g240`, carries the letter `a` or
`b` at five, its width and its height stand at twelve and sixteen, and its stream at `0x30`; the letter also
says whether the grey of every pixel stands as a step from the one behind it.

## The walk

Behind the head stand a word and a size. The word says which walk the stream holds:

* `re` is a run walk of its own: a byte that is not `0xF0` stands itself, and `0xF0` is followed by a count —
  of which nought, one and two say that the mark itself stands once, once and twice, and anything else says
  that as many copies of the value behind the count follow;
* `le` is the engine's own LZSS, of the kind the sibling ports share, of the size the head declares.

## The picture

The colour of every pixel of the twenty four bit picture is a step from the one before it, a byte a channel
at a time, with the first pixel of the picture standing as it is. The eight bit picture of the kind `a` takes
its grey the same way, walked from the last byte of the picture **backwards**; the kind `b` stands as it
stands. Both are handed out **bottom up**, which is what `ImageData.CreateFlipped` means.

Deviations from the reference, in the message only: a stream that ends inside its own head, a walk other than
the two the reference knows, a size that does not agree with the picture's own measurements, and a run that
reaches past it are refused with messages of this project's own. The write paths of both formats throw
`NotImplementedException`, so this is a read only pair.

The tests cover both heads and the letters of the eight bit one, the marks, letter and measurements they are
turned away for, the run walk with its three short counts, the step of the colour and of the grey, the twenty
four bit picture written out, a picture behind the engine's own LZSS, both kinds of the eight bit picture,
and the refusal of a walk the reader does not know.
