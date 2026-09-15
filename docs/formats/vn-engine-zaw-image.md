# GEM/vnengine image

Reference: `GARbro/ArcFormats/VnEngine/ImageZAW.cs`, class `ZawFormat`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/vn-engine/zaw-image.ts` (`vnEngineZawImageDescriptor`,
`vnEngineZawImageFormat`, id `vn-engine-zaw-image`, `readZawLayout`).

The file opens with `ZAW` and a header of sixty four bytes, whose first word after the signature is a
**checksum of the header itself** taken with that word cleared. A picture whose checksum does not hold up is
not one this format claims. Behind the signature sit the depth of the picture as a **byte**, its width, its
height and where its corner lies.

| the byte at `0x0C` | the picture is |
| --- | --- |
| `3` | thirty two bits to a pixel |
| `2` | sixteen |
| `1` | twenty four |
| anything else | eight |

The pixels are a **zlib stream** from offset `0x40`, one behind the other with no padding between the rows,
and what they hold depends on the depth:

* twenty four bits to a pixel, kept **red first**, where a bitmap keeps the other two first — the port turns
  them;
* eight bits to a pixel, handed the ramp of greys;
* sixteen bits to a pixel, a level of grey and what stands behind it, which becomes a picture of thirty two
  bits whose three colour bytes all carry the level;
* thirty two bits to a pixel, kept red first, and whose alpha byte is **stretched**: the reference multiplies
  it by `0xFF` and divides by `0x80`, holding the result to a whole byte, so a half turns into a whole and
  anything above it is held there. That scaling is kept as it is.

The reference unfolds as much as the stream gives and leaves the rest of the picture as it was, which is where
the zeroes of a short stream come from; a stream that does not unfold at all is refused with
`INVALID_ARCHIVE`, as is a picture of no width or no height with `UNSUPPORTED_FEATURE` and one of more than
256 MB with `LIMIT_EXCEEDED`. Nothing here writes the format.

The tests cover finding a header whose checksum holds up and declining one whose checksum does not, the four
depths the byte names, the corner and the measurements of the picture, a picture of twenty four bits with red
and blue the right way round, a picture of eight bits, one of sixteen bits made grey with what stands behind
it, one of thirty two bits with its alpha stretched, a picture whose stream does not unfold, and a stream that
gives less than the picture needs.
