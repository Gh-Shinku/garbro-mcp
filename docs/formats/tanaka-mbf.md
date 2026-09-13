# Tanaka MBF image archive

## Reference and attribution

- GARBro reference: `ArcFormats/Tanaka/ArcMBF.cs`, class `MbfOpener`
- GARBro tag: `MBF`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`MBF0` and `MBF1` archives store a 32-bit record count at 4, the first data offset at 8, and a flag
byte at 0x0c. The name index starts at 0x20 and holds length-prefixed CP932 names: a 16-bit length
that includes itself, followed by the name. When bit 0 of the flag is set and more than one record is
declared, GARbro skips a leading index record whose own 16-bit length is read at 0x20 and decrements
the count.

Sizes are not stored in the index. GARbro walks the payload area instead and reads the size from
each payload header: `BC` stores a 32-bit size at +2 and `$SEQ` stores it at +4, in both cases
counting the header bytes. The walk fails on any other header.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Length-prefixed name index | Supported |
| Flagged leading index record | Supported |
| `BC` and `$SEQ` payload header walk | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the name index, both payload headers, the flagged leading record, and
payload header rejection.
