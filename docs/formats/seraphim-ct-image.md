# Seraphim CT image

Reference: `GARbro/ArcFormats/Seraphim/ImageSeraph.cs`, class `SeraphCtImage`, which **extends** the three byte
picture of the same file (GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/seraphim/seraph-image.ts` (`seraphimCtImageDescriptor`,
`seraphimCtImageFormat`, id `seraphim-ct-image`).

The header is the header of the three byte picture — see `seraphim-cf-image.md` for it and for the table of
opcodes of the compressed stream — and the measurements are read by the very same code. What differs is the
picture:

1. the colour stream of three byte pixels is decoded from the byte behind the header, exactly as `CF` decodes it;
2. the reference then **seeks** to the length of the picture plus four bytes, counted from the end of the header,
   and decodes a second stream of single bytes there, with the decoder that `CB` uses;
3. the two are woven into whole pixels, one transparency byte to the pixel, and the rows are read from the
   bottom up, so the result is top down without a flip.

The transparency the reference writes is **inverted**: a byte `a` becomes `~(min (a × 255 / 100, 255))`, counted
in whole numbers, so a transparency of nought leaves the pixel opaque and a hundred or more leaves it clear.

Because the format extends `CF`, the reference registers it under the **same six words and the same trailing
zero**, and its own `Signature` word is never used: a picture that both formats would accept is found by `CF`
first, in the order the reference declares them. The port keeps that order — `CF` is registered before `CT` —
and reaches this format by asking for it.

The tests cover the words it is found by, a header without a stream, a picture woven with its transparency plane,
the plane being read where the length of the picture says it is rather than where the colour stream ends, and an
opcode in the plane that the reference does not know.
