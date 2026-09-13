# Tanaka WSM4 music archive

## Reference and attribution

- GARBro reference: `ArcFormats/Tanaka/ArcWSM.cs`, class `Wsm4Opener`
- GARbro tag: `WSM4`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The signature spells `WSM4`, but the word at 4 is the payload start rather than an index size. The entry count
sits at 0x0C, a table offset and count at 0x10 and 0x14, and the table has 0x24-byte records holding a payload
offset and size directly — the first version in this family whose spans are not biased.

Names are read separately at 0x44 with a 0x1A8-byte stride and a 0x40-byte field, one per *count*, so the table
must hold at least that many records: the reference would index past its own list and throw, while the port
rejects the archive. Payloads are stored verbatim, since this version installs no entry decoder.

## Support

| Capability | Status |
| --- | --- |
| `WSM4` signature and data offset | Supported |
| Table with direct offset and size pairs | Supported |
| Names at a fixed stride behind the head | Supported |
| Table-versus-count bound | Supported as a rejection |
| Entry placement validation | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a single named entry and a table smaller than the announced count.
