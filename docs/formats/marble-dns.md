# DarkNiteSystem DNS archive

## Reference and attribution

- GARBro reference: `ArcFormats/Marble/ArcDNS.cs`, class `DnsOpener`
- GARBro tag: `DNS`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

DNS archives are detected by the `data.dns` file name and a 32-bit value at offset 8 that
must equal 0x8000. The index occupies 0..0x8000 with 0x10-byte records: an 8-byte CP932 name,
a 32-bit offset at +8, and a 32-bit size at +12. Entry names are converted to the `.S`
extension and the payload bytes are negated (two's-complement) during extraction.

## Support

| Capability | Status |
| --- | --- |
| File-name detection | Supported |
| Fixed 0x8000 index area | Supported |
| `.S` name conversion | Supported |
| Byte negation on extraction | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
