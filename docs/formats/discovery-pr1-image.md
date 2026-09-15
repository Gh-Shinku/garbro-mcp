# Discovery PR1 image

Reference: `GARbro/Legacy/Discovery/ImagePR1.cs`, classes `Pr1Format`, `PrMetaData` and `PrReader` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/discovery/pr1-image.ts` (`discoveryPr1ImageDescriptor`,
`discoveryPr1ImageFormat`, id `discovery-pr1-image`). The animation resource of the same engine reads its header
and its planes with the same reader and is ported beside it as `discovery-an1-image`.

The reference registers **no signature** for this format: a picture is found by its extension, `.PR1` or `.AN1`,
and the header is read afterwards without a single check — not even a measurement of nought. The port keeps that
split: the descriptor declares no signature hint, the reader is reached through the extension fallback, and the
extension is checked inside the reader.

| offset | field |
|---|---|
| 0 | flags, of which the lowest bit picks the walk over the planes |
| 1 | a mask the reference's own reader ignores |
| 2 | the offset of the picture |
| 4 | its offset down |
| 8 | the width in **eighths of a pixel byte**; the reader shifts it left by three |
| 10 | the height |
| 12 | the colour map, sixteen colours, then the compressed planes |

The colour map is stored as **green, red, blue** and each byte is scaled by seventeen, so four bits of colour
become eight. A bitmap wants blue first, and the port stores it that way.

## The planes

The picture is four one bit planes woven into four bit pixels. Each plane holds eight pixels to the byte, and the
compressed stream describes them in **groups of four bytes** — one byte of every plane, which is eight pixels.

A group is written to all four planes at once by an opcode that also keeps what it wrote in one of four **sliding
windows**, each of them room for two hundred and fifty six groups and cleared of anything older. The control byte
carries a count of one to thirty two groups, a bit that picks the windowed opcodes and two bits that pick one of
three window kinds:

| control | meaning |
|---|---|
| `00`–`1F` | `(c & 1F) + 1` groups read as they stand, kept in the first window |
| `40`–`7F` | the same groups, kept in window `c >> 6`, of which at most `2^(kind-1)` are read and the rest repeated out of the window |
| `20`–`3F` | `(c & 1F) + 1` groups copied out of the first window, each at the offset its own byte names |
| `60`–`7F` | the same count of groups copied out of window `c >> 6`, the whole pattern starting again at the offset the opcode names |

A window moves on by the group its opcode meant to write even where the opcode had fewer groups left than that,
and its byte counter wraps at two hundred and fifty six groups, at which point the window starts again at its
beginning. The mask in the header plays no part: the reference's own reader ignores it, keeping the comment that
it decodes a single picture rather than overlaying one.

## The walk and the flattening

The lowest bit of the first header byte picks how the groups walk the planes:

* set — one group after another, the picture filled from its start;
* clear — down a column at a time, which writes the third group where the second would have been read: the
  flattening that follows walks the planes from their start, so the groups of the second column come before the
  one of the second row.

The reference's counter of the pixels it has woven wraps one pixel late, which changes nothing else it does; the
port keeps it as it stands.

Each plane byte becomes four bytes of the picture: the highest bit of every plane is the first of eight pixels
and the first plane is their lowest bit, so a pixel is `b0 + 2·b1 + 4·b2 + 8·b3` of the four plane bits that
name it.

## Failing

The reference reads its control bytes one way and everything else another: a stream that ends **between** opcodes
stops the decoder and leaves the rest of the picture as the zeroes it allocated, while one that ends in the middle
of an opcode or a window raises the failure the port answers with `INVALID_ARCHIVE`. A run that would write past
the end of a plane, and a window read that would reach outside its own, are the reference's own array overruns and
the port refuses them the same way. A picture of no pixels is refused with `UNSUPPORTED_FEATURE` where the
framework the reference hands it to would, and one larger than the port will hold with `LIMIT_EXCEEDED`.

The tests cover the extension that finds the pictures and the extensions that do not, a picture woven from four
one bit planes with the colour map scaled and reordered, the walk down the columns and the order it leaves, the
windowed opcodes that repeat what they have just written and take groups back out by an offset, a stream that ends
in the middle of an opcode, a run that reaches past a plane, and a picture of no pixels.
