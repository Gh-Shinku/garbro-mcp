# Ankh MSK bitmap

Reference: `GARbro/ArcFormats/Ankh/ImageMSK.cs`, class `MskFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/ankh/msk-image.ts` (`ankhMskImageDescriptor`, `ankhMskImageFormat`, id
`ankh-msk-image`).

An **LZSS compressed eight bit gray mask**. The signature word is `0x6B736D`, that is `msk` followed by a
zero byte, and the header carries a flag that moves the stream:

| field | offset |
|---|---|
| signature `msk\0` | 0 |
| width (`u32`) | 4 |
| height (`u32`) | 8 |
| flag (`i32`) | 0xC |
| LZSS stream | the flag is zero: 0x10, non-zero: **0xC** |

That last row is the interesting part. `ReadMetaData` sets `HeaderSize` to **twelve** when the flag field is
non-zero and sixteen when it is zero, which means the short form starts the compressed stream *inside the
flag field* — the first control byte of the LZSS stream is the same byte the port just read as the size
selector. The two readings are consistent, because a non-zero byte is exactly what selects the short form.
The port reproduces this and a test builds the short form by placing the stream at offset twelve, asserting
the selected header size in the archive metadata.

The port exposes the resource as a single entry:

* the codec is the repository's `inflateLzssAll` with the default GARbro settings, the same path the MD, GRD,
  CSF and ADVGSys ports use. Because this container declares no unpacked size, the output is capped at
  64 MiB;
* the reference reads into a zero filled buffer of `width * height` bytes, so a stream that ends early leaves
  the remaining pixels **zero** rather than failing. The port fills the buffer the same way, and a test
  decodes two pixels of a six pixel image and asserts the other four are zero;
* `Read` uses `ImageData.CreateFlipped`, so rows are stored **bottom up** and the bitmap is written with a
  **positive** height, using the shared `writeBmp8` helper — the same flag the GameSystem ALP and TEXB ports
  rely on. Odd widths exercise the row padding, which `writeBmp8` adds;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file, and is
  flagged `compressed: true` with `sizeKnown: false`;
* entry metadata carries `type: "image"`, width, height and `bitsPerPixel: 8`; the archive metadata records
  `image: "bmp"`, `compression: "lzss"` and the selected header size.

Deviations, both tested: a zero width or height is declined, where the reference would decode an empty image,
and a file too short to hold the selected header is declined before any decode. Nothing else is validated,
which is faithful — the output of this format is always a well formed gray bitmap, so there is no container
structure to check against.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope. The
descriptor registers no extension, matching the reference, which tests the signature instead; the symbols are
prefixed with the engine because the `MSK0` port for Cmvs already owns the unprefixed names.
