# Ankh GPD compressed image

Reference: `GARbro/ArcFormats/Ankh/ImageGPD.cs`, class `GpdFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/ankh/gpd-image.ts` (`ankhGpdImageDescriptor`, `ankhGpdImageFormat`, id
`ankh-gpd-image`).

A twenty four bit image behind a sixteen byte header, compressed with LZSS. The interesting part is where the
stream starts:

| field | offset |
|---|---|
| signature `gpd` and a null | 0 |
| width (`u32`) | 4 |
| height (`u32`) | 8 |
| layout flag (`i32`) | 0xC |

`ReadMetaData` sets the header size to **twelve** when the word at offset `0xC` is non-zero and to **sixteen**
when it is zero. Since offset `0xC` *is* that word, a file with the short layout starts its compressed stream
inside the field that selects the layout: the first LZSS control byte doubles as the flag. This is the same
shape as the Ankh MSK reader in this directory, and a test proves both layouts decode to the same image while
the files differ in length — the short layout drops four header bytes and stores the stream's first byte in the
vacated word, so its file is exactly four bytes shorter.

The port exposes the resource as a single entry:

* decompression uses the shared `inflateLzssAll` with GARbro's default settings and a cap of the pixel count,
  which is all the reader ever consumes;
* the reference allocates the pixel buffer and then reads only as much of the stream as fits, so a stream that
  ends early leaves the rest of the buffer **zeroed** instead of failing. The port reproduces that with an
  explicitly zeroed buffer, and a test truncates a file to the header plus four bytes and asserts that the
  length and the zero tail are as expected. The MSK and GR1 readers document the same behaviour;
* the pixels are bottom up (`ImageData.CreateFlipped`), so the bitmap takes a **positive** height, and the
  stored rows are packed at `width * 3` with no row alignment;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file, and is flagged
  `compressed: true` with `sizeKnown: false`;
* entry metadata carries `type: "image"`, the dimensions and `bitsPerPixel: 24`; the archive metadata records
  `image: "bmp"`, `compression: "lzss"`, the dimensions and the resolved `streamOffset`;
* the signature `gpd` and a null is registered, and the `.gpd` extension is declared as metadata.

The signature deserves a note. GARbro reads the first four bytes of a file as one little endian word and compares it
with the format's constant, so a constant of `0x647067` matches only a file whose fourth byte is **zero**. The probe
here asks for the four bytes for that reason, and a file whose fourth byte is anything else is another format.

Deviations, both tested: zero width or height is declined, where the reference would build an empty image, and a
file shorter than the header is declined before any read.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope.

## Two fixture corrections

The short-layout fixture wrote the flag word into the header buffer and then concatenated only the first twelve
bytes of it, so the control byte never reached the file and the port read unrelated bytes as the flag. Fixing
that changed the implied length relation: the first assertion expected the short file to be four bytes shorter,
the broken fixture made it five, and the corrected fixture is four — a reminder that when a length assertion
fails, the fixture's own arithmetic is as likely to be wrong as the port's.
