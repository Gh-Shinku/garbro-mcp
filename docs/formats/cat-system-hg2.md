# CatSystem2 HG2 multi-image

## Reference and attribution

- GARBro reference: `ArcFormats/CatSystem/ArcHG2.cs`, class `Hg2Opener`
- GARBro tag: `HG2`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `HG-2` file starts with the signature and the marker `0x25` at offset 8. Sections begin at 0x0c
and each section stores its own size at +0x40. GARbro emits one entry per section, named
`<archive>#<n padded to 4>`, whose size is that section size. A zero section size ends the walk and
the section then runs to the end of the file.

## Support

| Capability | Status |
| --- | --- |
| Signature and marker detection | Supported |
| Section walk with self-declared sizes | Supported |
| Zero-size final section | Supported |
| Generated section names | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Section decoding | Not applicable |
| Archive creation | Unsupported |

Synthetic fixtures cover the section walk, the zero-size final section, and marker rejection.
