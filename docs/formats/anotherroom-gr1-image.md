# AnotherRoom GR1 bitmap

Reference: `GARbro/Legacy/AnotherRoom/ImageGR1.cs`, class `Gr1Format`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/anotherroom/gr1-image.ts` (`gr1ImageDescriptor`, `gr1ImageFormat`, id
`anotherroom-gr1-image`).

An **LZSS compressed 16 bit 555 bitmap**. The header opens with `LUVLATIO` — the registry signature `LUVL`
is followed immediately by the marker `LATIO` that `ReadMetaData` checks:

| field | offset |
|---|---|
| `LUVL` | 0 |
| `LATIO` | 4 |
| width (`u32`) | 0x1C |
| height (`u32`) | 0x20 |
| LZSS stream | 0x24 |

The port re-checks the marker even though the signature already matched, and a test changes only the last
character of `LATIO` so the signature still matches and the marker is what rejects the file.

The port exposes the resource as a single entry:

* the codec is the repository's `inflateLzssAll` with default GARbro settings. The container declares no
  unpacked size, so the output is capped at 64 MiB;
* the source pixels are fifteen bit `Bgr555`, so the port writes them with the shared `writeBmp16` helper —
  the same writer the MBP port uses, which keeps the stored 555 values rather than widening them. The entry
  reports `bitsPerPixel: 15`, matching the source, while the bitmap itself is sixteen bit. Odd widths
  exercise the row padding: a three pixel row is six stored bytes inside an eight byte bitmap row, and the
  test asserts both the pixels and the padding;
* `Read` uses `ImageData.CreateFlipped`, so rows are stored bottom up and the bitmap takes a **positive**
  height;
* the reference reads into a zero filled buffer of `width * 2 * height` bytes, so a short stream leaves the
  remaining pixels zero. That extends to the extreme case: a file with a valid header and **no stream at
  all** decodes to a completely zeroed image, which the reference accepts. The port accepts it too, and a
  test pins that behaviour rather than treating it as an error;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file, and is
  flagged `compressed: true` with `sizeKnown: false`;
* entry metadata carries `type: "image"`, width, height and bit depth; the archive metadata records
  `image: "bmp"`, `compression: "lzss"` and the dimensions.

Declines, all tested: a wrong marker, a different signature, a zero width or height (the reference would
decode an empty image) and a file that stops inside the header.

Two fixture mistakes were made while testing this port, and both were the test's fault rather than the
port's, which is worth recording because the port was derived from the reference before either test ran:
the marker-breaking test originally wrote `0x4F`, which *is* the character `O` it meant to replace, and the
truncation test originally truncated to exactly the header size, which is a complete file with an empty
stream rather than a truncated one. A third mistake followed from the formatting trap: a scripted
replacement silently failed to match because the formatter had already rewrapped the surrounding call, so
half the intended repair was applied and the failure persisted.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope. The
descriptor registers no extension, matching the reference.
