# Entertainment Executive PackDat3 archive

## Reference and attribution

- GARBro reference: `ArcFormats/EntExec/ArcCAB.cs`, class `CabOpener`
- GARBro tag: `CAB/PackDat3`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts with the ASCII signature `Pack` and the format marker `Dat3` at offset 4. A
32-bit record count follows at offset 8 and the index starts at 0x0c. Every record is 0x10c bytes:
a 0x100-byte CP932 name and three little-endian 32-bit values for the data offset, the stored size,
and the declared unpacked size.

The reference implementation never decodes the declared unpacked size; entries are exposed as raw
byte ranges, and an archive is rejected as soon as one entry fails the placement check.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| 0x100-byte CP932 names | Supported |
| Entry placement validation | Supported |
| Declared unpacked size metadata | Supported |
| Entry listing and extraction | Supported |
| Unpacked size decoding | Unsupported |
| Archive creation | Unsupported |

Unpacked size decoding is listed as unsupported because the reference implementation stores the
value without applying any decompressor.

Synthetic fixtures cover the index layout, CP932 names, raw extraction, marker rejection, and entry
placement rejection.
