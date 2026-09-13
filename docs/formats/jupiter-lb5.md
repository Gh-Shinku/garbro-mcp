# Jupiter LB5 resource archive

## Reference and attribution

- GARBro reference: `Legacy/Jupiter/ArcLB5.cs`, class `Lb5Opener`
- GARBro tag: `LB5`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The `.lb5` file holds only payloads; a sibling `.idx` file holds the index, which GARbro locates with
`Path.ChangeExtension`. The companion stores a 32-bit record count and 0x18-byte records with the data
offset, the stored size, and a 15-byte CP932 name behind +9. GARbro validates every range against the
payload file.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Companion `.idx` index | Supported |
| 0x18-byte records | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the companion index, extension rejection, and missing-companion rejection.
