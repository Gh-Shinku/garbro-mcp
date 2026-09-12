# BlackRainbow CCF archive

## Reference and attribution

- GARBro reference: `ArcFormats/BlackRainbow/ArcCCF.cs`, class `CcfOpener`
- GARBro tag: `CCF`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`CCF` archives start with the ASCII signature `CCf"` and a 32-bit entry count at offset 4.
The index at offset 8 holds one 32-bit offset per entry relative to the end of the index.
Entries have no stored names; GARbro emits `<basename>#0000`, `#0001`, ... and derives sizes
from neighbouring offsets, with the last entry running to the end of file.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Derived entry sizes | Supported |
| Generated entry names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
