# Studio Polaris GR2 resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/AdvSys/ArcGR2.cs`, class `Gr2Opener`
- GARBro tag: `GR2/PACK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `PACK` archive stores a 32-bit record count at 4 and the data base at 8, which must lie behind the
0x10-byte header. Records start at 0x10 and are 0x18 bytes wide: a 0x10-byte CP932 name, the stored
size, and the data offset, which must not precede the data base. The format is dispatched for the
`gr2`, `vic`, and `pac` extensions.

Payloads that start with `LL5\0` are expanded with GARbro's LL5 run-length codec: a signed byte
introduces each block, a negative value copies that many literal bytes, and a non-negative value
repeats the following byte that many times.

The port expands LL5 payloads while listing, because only then is the unpacked size known and
extraction can verify it. Decoded payloads stay in memory for the lifetime of the handle.

## Support

| Capability | Status |
| --- | --- |
| Extension and signature detection | Supported |
| Data base validation | Supported |
| 0x18-byte records | Supported |
| LL5 run-length decompression | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the record layout, LL5 round-trip through a matching compressor, data base
rejection, and extension rejection.
