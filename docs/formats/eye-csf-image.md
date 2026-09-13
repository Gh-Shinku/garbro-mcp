# Eye CSF compressed bitmap

Reference: `GARbro/Legacy/Eye/ImageCSF.cs`, class `CsfFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/eye/csf-image.ts` (`csfImageDescriptor`, `csfImageFormat`, id
`eye-csf-image`).

An **LZSS stream holding a Windows bitmap behind an eleven byte prefix**. The reference declares no
signature at all: it reads eleven bytes, checks that they start with the ASCII `CSF`, seeks to `0xB` and
wraps the rest of the file in `LzssStream`, whose defaults (4 KiB window, zero fill, ring start `0xFEE`,
a set control bit meaning a literal byte) are exactly what the repository codec implements — the same
settings verified against `ArcFormats/LzssStream.cs` for the Mina MD and Silky GRD ports.

Because there is no signature, detection has to decompress the stream to say anything at all. The port
caps that with the same 64 MiB `maxOutputLength` guard the other compressed-bitmap ports use, so a hostile
header cannot ask for an unbounded allocation.

The port exposes the resource as a single entry:

* detection checks the `CSF` prefix, decompresses, and then requires a `BM` magic, a `bfSize` between the
  fifty four byte header and the decompressed length, a DIB header of at least forty bytes (an OS/2 core
  header is declined), non-zero dimensions and a non-zero bit depth. The seven bytes of the prefix after
  `CSF` are never inspected, which a test asserts;
* extraction decompresses the payload and **trims it to the length the bitmap declares**, since the
  reference rebuilds the bitmap from its own header; a stream carrying trailing bytes beyond `bfSize`
  therefore extracts the bitmap alone, which is tested;
* the entry is named after the source file with a `bmp` extension, covers the compressed payload, is
  flagged `compressed: true` and sets `sizeKnown: false` because the extracted length differs from the
  stored one;
* entry metadata carries `type: "image"` with the dimensions and bits per pixel, and the archive metadata
  records `image: "bmp"` and `compression: "lzss"` alongside them.

Encoding and archive creation are out of scope.
