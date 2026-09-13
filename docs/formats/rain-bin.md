# Rain Software BIN resource archive

## Reference and attribution

- GARBro reference: `Legacy/Rain/ArcBIN.cs`, class `BinOpener`, with `ArcFormats/LzssStream.cs`
- GARbro tag: `BIN/RAIN`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Detection depends on the file name as much as on the contents: GARbro only opens `pack<xxx>.bin`, and
the three captured characters become the extension of every entry name, which is built as a five-digit
number plus that extension. The count sits at 0 and carries a compression flag in its high bit — which
the reference computes but never consults, because compression is decided per entry further down.

Records are twelve bytes wide: the entry number, which must be unique and at most 0xFFFFFF, then the
data offset, which must land behind the index, and the size.

`BinOpener.OpenEntry` decodes payloads that start with `SZDD` as LZSS streams, skipping twelve bytes,
with a ring fill of 0x20 and an initial ring position of 0xFF0 rather than the defaults. The port passes
both overrides to the shared decoder, reads the unpacked length that a SZDD header stores at +8 for
listing (the reference never reads it), and marks those entries as having an inexact size because the
decoder stops at the end of the stored stream. The reference also routes `*.cgd` entries to its CG
decoder, which is an image concern outside the archive layer.

## Support

| Capability | Status |
| --- | --- |
| `pack<xxx>.bin` name pattern and derived extension | Supported |
| Count word with its high flag bit masked off | Supported |
| Unique entry numbers bounded at 0xFFFFFF | Supported |
| Twelve-byte records with offset and size | Supported |
| Data offset behind the index | Supported |
| Entry placement validation | Supported |
| `SZDD` detection with the twelve-byte skip | Supported |
| LZSS extraction with fill 0x20 and ring position 0xFF0 | Supported |
| Verbatim extraction for other payloads | Supported |
| `*.cgd` image decoding | Not ported |
| Archive creation | Unsupported |

Synthetic fixtures cover a plain and an `SZDD` payload, the name pattern requirement, a duplicate entry
number, and an offset pointing inside the index. The `SZDD` fixture is built so that a single control
byte drives two matches, which only decode to the expected bytes when both overridden LZSS settings are
in effect. Building it surfaced that this variant's forward-walking ring makes a match at the write
cursor reproduce earlier output rather than fill bytes.
