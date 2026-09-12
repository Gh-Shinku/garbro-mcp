# MMFass SDA archive

## Reference and attribution

- GARBro reference: `Legacy/Mmfass/ArcSDA.cs`, class `SdaOpener`
- GARBro tag: `SDA/MMFASS`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`SA` archives start with the ASCII bytes `SA` and a 32-bit data offset at 4. The entry count
is derived from `(dataOffset - 8) / 0x1c`, which must divide evenly. Each 0x1c-byte record
holds a 0x14-byte CP932 name, a 32-bit offset at +0x14 relative to the data offset, and a
32-bit size at +0x18.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Derived entry count | Supported |
| Base-relative offsets | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
