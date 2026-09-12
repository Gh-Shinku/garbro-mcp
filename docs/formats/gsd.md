# MicroVision GSD archive

## Reference and attribution

- GARBro reference: `ArcFormats/MicroVision/ArcGSD.cs`, class `GsdOpener`
- GARBro tag: `GSD`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`GSD` archives begin with the ASCII signature `GSD` followed by a NUL byte. The header stores
an entry count at 0x1c and a base offset at 0x08. The index begins at 0x34 and uses 0x20-byte
records containing a 32-bit offset relative to the base offset and a 32-bit size. Entry data has no
stored names; GARbro generates `00000.wav`, `00001.wav`, and so on, marking each entry as audio.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Base-relative offsets | Supported |
| Generated WAV names | Supported |
| Entry listing and extraction | Supported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
