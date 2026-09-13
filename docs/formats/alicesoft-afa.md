# AliceSoft AFA (AliceSoft System 4 resource archive)

Reference: `GARbro/ArcFormats/AliceSoft/ArcAFA.cs`, class `AfaOpener`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/alicesoft/afa.ts` (`alicesoft-afa`).

## Detection and variants

`AfaOpener.TryOpen` first checks `AsciiEqual(8, "AlicArch")`; when that fails it falls back to the
version three reader (`AfaIndexReader`, bit stream coded index), which is **not ported yet**, so a
version three archive is declined. The ported variant keeps the `INFO` marker check at `0x1C`, so it
is the header gate that distinguishes the two layouts.

## Header

| Offset | Size | Meaning |
|--------|------|---------|
| `0x00` | 4 | `AFAH` signature |
| `0x08` | 8 | `AlicArch` |
| `0x10` | 4 | version (`i32`) |
| `0x18` | 4 | base offset (`u32`) |
| `0x1C` | 4 | `INFO` |
| `0x20` | 4 | compressed index size |
| `0x24` | 4 | uncompressed index size |
| `0x28` | 4 | entry count |
| `0x2C` | … | zlib compressed index |

The count must pass `IsSaneCount`, the compressed index must fit in the file, and it is inflated with
`inflateZlibBuffer`; a decoder failure declines the archive.

## Index records

Each record starts with `[i32 nameLength][i32 indexStep]` followed by `indexStep` bytes of name, of
which the first `nameLength` are used. Names are decoded as cp932 (the reference uses its
`AFAEncodingCP` setting, default `DefaultEncoding`). After the name the reader skips **two** words,
plus **one more** when `version < 2`, and then reads `[u32 offset][u32 size]`; the offset is relative
to the base offset from the header. `nameLength > 0`, `nameLength <= indexStep <= uncompressed size`
and `checkPlacement` are all enforced; names are normalised to forward slashes with the original kept
as `rawPath` (the reference format is hierarchic).

## Payloads

An entry larger than `0x10` bytes that begins with `AFF\0` holds a sixteen byte header followed by a
keyed region: the first `min(0x40, size - 0x10)` bytes are XORed with the repeating sixteen byte key

```text
C8 BB 8F B7 ED 43 99 4A A2 7E 5B B0 68 18 F8 88
```

and the remainder is stored verbatim. `alicesoft-afa` reproduces this by unmasking that region and
concatenating it back between the header and the untouched tail, so the extracted length always
equals the declared size (the transform is length preserving, hence `sizeKnown` stays true). Payloads
without the marker are copied as is. There is **no** entry level decompression: the contained formats
(`QNT`, `AJP`, `DCF`, `OGG`) own that, and their decoders are out of scope here.

## Deviations

* The version three index reader (`AfaIndexReader`) is not implemented yet; such archives are
  declined instead of listed. Its layout is an MSB first bit stream from offset 12 with a
  dictionary, a packed size, an unpacked size and a packed byte array, then a zlib stream, with names
  run through `DecryptString` and `RandomGenerator`.
* The archive is exposed as a flat listing that preserves the stored paths; there is no hierarchical
  archive view beyond path normalisation.
