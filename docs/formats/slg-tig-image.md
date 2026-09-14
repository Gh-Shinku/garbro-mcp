# SLG system encrypted PNG image

Reference: `GARbro/ArcFormats/Slg/ImageTIG.cs`, class `TigFormat` (and its `TicFormat` sibling, the same
cipher over a JPEG, not ported yet). GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT.

Implementation: `packages/formats/src/slg/tig-image.ts` (`slgTigImageDescriptor`, `slgTigImageFormat`, id
`slg-tig-image`).

A portable network graphic whose **whole stream** is scrambled by subtracting, from every byte, the **low byte
of one draw** of the Microsoft C runtime's linear congruential generator. The generator is seeded with
`0x7F7F7F7F` and starts drawing at the file's first byte, so the registered word `0x7CF3C28B` is the graphic's
own signature through that scramble. The generator is the same one the SLG TIM image uses, and the port reuses
`MsvcRandom` from the codecs, whose own reference line already names this very file.

The measurements come from the **decrypted** head: the port decrypts only as much as the signature, the first
chunk's own header and its thirteen header bytes need and reads the width, height and depth from there with the
shared reader, exactly as the reference does through a decrypting stream in front of its graphic reader. A
palette colour type is reported as twenty four bits and the other types at their own depth, as that reader does.

Because the scramble covers the whole file, an entry's bytes are not the ones the file holds: the entry returns
the decrypted graphic itself, produced by one generator run from the file's first byte, and it is reported as
compressed for the same reason. The format declares no extension, so the word is the only way in.

Details worth recording:

* `TigTransform` in the reference and the `RandomGenerator` beside it are one file's own classes rather than
  shared code; the generator's constants (`0x343FD`, `0x269EC3`, the **high** word returned) are the ones
  `MsvcRandom` already implements;
* the scramble is its own kind of weak: a file scrambled with any other seed does not come out as a graphic, and
  a plain graphic is not mistaken for one of these;
* a stream shorter than a header, one whose decrypted chunk is not `IHDR`, and one whose depth or colour type the
  reader does not know are refused before anything further is decrypted.

The tests cover the registered word and the absent extension, the need for the cipher and the seed it starts
from, the measurements of the decrypted header, the decrypted output with the file's own bytes recovered by
scrambling it again, a plain graphic, a wrongly scrambled one, heads the reader refuses, and the entry name.
