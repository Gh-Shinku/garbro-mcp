# SYSD DPK archive

## Reference and attribution

- GARBro reference: `ArcFormats/SysD/ArcDPK.cs`, class `DpkOpener`
- GARBro tag: `DPK/SYSD`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`DPK` archives start with the ASCII bytes `PA`, followed by a little-endian header:

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0x00 | 2 | signature `PA` |
| 0x02 | 2 | entry count |
| 0x04 | 4 | total archive size |

The index begins at 0x08 and uses 0x14-byte records with a null-terminated CP932 filename and a
32-bit size. Payloads follow the index sequentially in record order; no offsets are stored.

GARbro additionally requires the declared total size to equal the physical file size, which makes
the structural check strong enough to identify archives that carry no other signature.

## Support

| Capability | Status |
| --- | --- |
| Signature and size-field detection | Supported |
| CP932 filenames | Supported |
| Sequential payloads | Supported |
| Entry listing and extraction | Supported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
