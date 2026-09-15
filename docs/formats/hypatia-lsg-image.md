# Kogado image

Reference: `GARbro/ArcFormats/Hypatia/ImageLSG.cs`, classes `LsgFormat` and `LsgMetaData`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/hypatia/lsg-image.ts` (`hypatiaLsgImageDescriptor`,
`hypatiaLsgImageFormat`, id `hypatia-lsg-image`, `readLsgLayout`).

A picture opens with the word a bitmap opens with — `BM` — and then with a header that is **not** a bitmap
header, though it sits where one would: the length of the pixels, the depth of the picture, its width and its
height, twenty bytes in all. A depth other than eight or twenty four bits is not one this format claims.

The pixels are kept one behind the other with **no padding between the rows**, so the writer behind them pads
them where a bitmap wants it. A picture of twenty four bits becomes a bitmap of the same depth; a picture of
eight bits becomes a bitmap of eight bits, and is handed a colour map that lives in a **companion file**:

1. the file named after the picture with the extension `pal` exchanged for its own, beside it;
2. otherwise `base.pal` in the same directory;
3. otherwise no colour map at all, and the ramp of greys a bitmap without one is handed.

The companion holds three bytes to a colour — red first — where a bitmap keeps four, and the port turns them
the way the reference's own colour map reader does. A companion that is there but holds less than a whole map
of 256 colours is refused with `INVALID_ARCHIVE`, as is a picture cut short of the pixels its header declares.
A picture of no width or no height is refused with `UNSUPPORTED_FEATURE`, and one whose pixels would need more
than 256 MB with `LIMIT_EXCEEDED`.

Nothing here writes the format: `LsgFormat.Write` is not implemented in the reference either. The reference
reads the pixels and hands them to its imaging layer unpadded, which this port does not need to; everything
else follows it, including the order in which it looks for the colour map.

The tests cover finding a picture of eight or twenty four bits and declining any other depth, the entry's name
and the length of its pixels, a picture of twenty four bits whose rows are padded in the bitmap, the ramp of
greys a picture without a colour map is handed, the colour map of a companion named after the picture, the
fallback to `base.pal`, a picture cut short of its pixels, a companion holding no whole colour map, and a
picture of nothing.
