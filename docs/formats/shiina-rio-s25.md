# ShiinaRio S25 multi-image

## Reference and attribution

- GARBro reference: `ArcFormats/ShiinaRio/ArcS25.cs`, class `S25Opener`
- GARBro tag: `S25`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `S25` file starts with the ASCII signature followed by a NUL byte and a 32-bit frame count at 4,
which must be positive and at most 0xfffff. The index at 8 holds one 32-bit offset per frame; GARbro
skips offsets that are zero or beyond the end of the file.

Surviving entries keep the name `<archive>@<index padded to 4>`, where the index is the position in
the original table. GARbro sorts the entries by offset and derives each size from the next offset,
with the last entry running to the end of the file, so bytes of skipped frames are covered by their
predecessor.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Flat offset index | Supported |
| Out-of-range offset skipping | Supported |
| Offset sorting and derived sizes | Supported |
| Generated frame names | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Frame decoding | Not applicable |
| Archive creation | Unsupported |

GARbro's image decoder reads frame dimensions from the payload; the extracted bytes are unchanged
either way.

Synthetic fixtures cover the offset walk, skipped offsets, generated names, and signature rejection.
