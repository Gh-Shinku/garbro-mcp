# Abel BIN archive

## Reference and attribution

- GARBro reference: `ArcFormats/Abel/ArcBIN.cs`, class `FilepakOpener`
- GARBro tag: `BIN/ABEL`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Abel archives have no magic signature: a 32-bit value at offset 0 must equal the file size.
A 32-bit entry count sits at 4, a 32-bit index size at 8, and a 32-bit index position at 0x14.
The index is the first `indexSize` bytes of the file and contains, per entry, a 32-bit name
position, a 32-bit absolute offset, and a 32-bit size. Names are null-terminated CP932 strings
stored inside the index; leading `\` and `/` characters are stripped.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| In-index name table | Supported |
| Leading separator stripping | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
