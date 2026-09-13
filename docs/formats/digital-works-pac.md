# Digital Works PAC resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/DigitalWorks/ArcPAC.cs`, class `PacOpener`
- GARBro tag: `PAC/HED`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive file only carries the ASCII signature `PPAC-PAC`. Its index lives in a sibling file with the same base
name and a `.hed` extension, which must start with `PPAC-HED`. The reference counts records as
`(hedLength - 0x10) / 0x20` and walks them while a whole record fits, so trailing bytes shorter than a record are
ignored.

Each 0x20-byte record holds a 0x10-byte CP932 name, a payload offset biased by 0x10, and a stored size. Payloads are
checked against the archive file, not the index file.

## Extraction

`PacOpener.OpenEntry` sets the packed flag lazily when an entry starts with `LZS\0`. The word after the marker is the
declared unpacked size, and the payload behind the eight-byte header is decoded as a default GARbro LZSS stream. The
port performs the same inspection while reading the index so listing and extraction agree, and marks those entries as
having an inexact size because the decoder stops at the end of the stored stream.

When the stored data behind the `LZS\0` header itself starts with a nested marker — three `LZS` bytes behind a first
byte whose low nibble is `0xF` — the reference decodes twice: the first stream yields an eight-byte header followed by
a second LZSS stream, the header's second word becomes the unpacked size, and the second stream is decoded again. The
port reproduces both layers and records the nested marker in entry metadata.

Entries that do not start with `LZS\0` are emitted verbatim, including stored data that happens to contain a nested
marker elsewhere.

## Support

| Capability | Status |
| --- | --- |
| `PPAC-PAC` signature | Supported |
| Companion `PPAC-HED` index | Supported |
| 0x20-byte records with CP932 names | Supported |
| Payload offsets biased by 0x10 | Supported |
| Entry placement validation | Supported |
| `LZS\0` marker with declared unpacked size | Supported |
| Default LZSS extraction | Supported |
| Nested LZS double decoding | Supported |
| Verbatim extraction | Supported |
| Entry type inference | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover stored, single LZSS and nested LZSS entries, plus a missing companion and a foreign index
signature.
