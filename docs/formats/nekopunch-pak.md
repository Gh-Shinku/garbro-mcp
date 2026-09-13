# Studio Nekopunch PAK archive

## Reference and attribution

- GARBro reference: `ArcFormats/Nekopunch/ArcPAK.cs`, class `PakOpener`, with `ArcFormats/LzssStream.cs`
- GARBro tag: `PAK/NEKOPUNCH`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `PACK` archive keeps its entry count at 4 and a single flag at 8 that applies to the whole archive
rather than to individual entries. The index starts at 0x10 and every record is 0x4C bytes wide: a
0x40-byte name field followed by the unpacked size, the stored size, and the data offset.

`PakOpener.OpenEntry` consults that archive-wide flag: when it is set, every payload is decoded as an
LZSS stream using GARbro's `LzssStream` defaults, which are also the defaults of `@garbro-mcp/codecs`,
and the stored size is then the compressed length. Because the decoder stops at the end of the stored
stream instead of at the declared output length, packed entries are marked as having an inexact size.
Otherwise payloads are stored verbatim.

GARbro also registers a resource alias that links the `DOW` extension to its WaveAudio format. That is
a catalog concern outside the archive layer and is not ported.

## Support

| Capability | Status |
| --- | --- |
| `PACK` signature and `.pak` extension | Supported |
| Entry count validation | Supported |
| Archive-wide packed flag | Supported |
| 0x40-byte CP932 name field with blank rejection | Supported |
| Unpacked size, stored size and offset words | Supported |
| Entry placement validation | Supported |
| LZSS extraction with GARbro's default settings | Supported |
| `DOW` audio resource alias | Not ported |
| Archive creation | Unsupported |

Synthetic fixtures cover stored payloads, LZSS payloads under the archive-wide flag, the extension
requirement, and blank name rejection.
