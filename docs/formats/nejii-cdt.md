# NEJII engine CDT resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Nejii/ArcCDT.cs`, class `CdtOpener`, with `ArcFormats/LzssStream.cs`
- GARbro tag: `CDT`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

This archive identifies itself from the end rather than the start. Its last twelve bytes hold `RK1`
with a null byte, the entry count, and the index offset, which must point inside the file. GARbro
registers the format for the `cdt`, `pdt`, `vdt`, and `ovd` extensions and keeps no start signature, so
the trailer is the only structural evidence.

Records are 0x20 bytes wide: a 0x10-byte name field, the stored size, the unpacked size, a word that
marks the entry as compressed when it is non-zero, and the data offset. `CdtOpener.OpenEntry` decodes
compressed payloads as LZSS streams with GARbro's `LzssStream` defaults, which are also the defaults of
`@garbro-mcp/codecs`, and the port marks those entries as having an inexact size because the decoder
stops at the end of the stored stream rather than at the declared output length.

## Support

| Capability | Status |
| --- | --- |
| Trailer detection (`RK1`, count, index offset) | Supported |
| Entry count validation | Supported |
| Index offset bound | Supported |
| 0x20-byte records with a 0x10-byte name field | Supported |
| CP932 filenames | Supported |
| Entry placement validation | Supported |
| Compressed flag from the third word | Supported |
| LZSS extraction with GARbro's default settings | Supported |
| Verbatim extraction for other payloads | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover plain and LZSS payloads, a foreign trailer, an index offset beyond the file, and
an empty entry count. A fixture caught a real bug: the count and index offset were swapped relative to
the trailer's layout.
