# KAAS PB audio archive

## Reference and attribution

- GARBro reference: `ArcFormats/Kaas/ArcPB.cs`, class `PbOpener`
- GARBro tag: `PB`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`PB` files are detected by extension. A 32-bit entry count at offset 0 must be between 1
and 0xfff. The index starts at 0x10 and uses 8-byte records with a 32-bit absolute offset and
a 32-bit size. The first payload offset must not point back into the index.

Entries have no stored names: GARbro emits `0000`, `0001`, ... and appends `.pb` when the
archive itself is named `voice.pb`.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| 16-bit-style count bound | Supported |
| Voice.pb naming | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
