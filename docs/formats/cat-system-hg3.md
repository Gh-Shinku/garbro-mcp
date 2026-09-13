# CatSystem2 HG3 multi-image

## Reference and attribution

- GARBro reference: `ArcFormats/CatSystem/ArcHG3.cs`, class `Hg3Opener`
- GARBro tag: `HG3`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `HG-3` file starts with the signature; sections begin at 0x0c. GARbro walks sections while the
`stdinfo` marker at +8 matches. A section stores its size at +0, the size of the `stdinfo` block at
+0x10, and contributes an entry only when an `img` chunk follows that block. A zero section size
means the section runs to the end of the file.

Entries cover the section without its eight-byte header and are named `<archive>#<n padded to 4>`,
where the number counts sections rather than emitted entries.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| `stdinfo` section walk | Supported |
| `img` chunk requirement | Supported |
| Zero-size final section | Supported |
| Section-indexed entry names | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Section decoding | Not applicable |
| Archive creation | Unsupported |

Synthetic fixtures cover the section walk, sections without an `img` chunk, entry naming, and marker
rejection.
