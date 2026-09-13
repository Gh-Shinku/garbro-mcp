# Foster C24 and C25 multi-image

## Reference and attribution

- GARBro reference: `ArcFormats/Foster/ArcC24.cs`, classes `C24Opener` and `C25Opener`
- GARBro tags: `C24` and `C25`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Both variants share one layout: a `C24` or `C25` signature followed by a 32-bit frame count at 4 and
one 32-bit frame offset per record from 8. Offsets that are zero or beyond the end of the file are
skipped.

GARbro sorts the surviving frames by offset and derives each size from the next offset, letting the
last frame run to the end of the file. Names keep their original position in the table as
`<archive>@<n padded to 4>`.

## Support

| Capability | Status |
| --- | --- |
| Signature detection for both variants | Supported |
| Frame offset table | Supported |
| Out-of-range offset skipping | Supported |
| Offset sorting and derived sizes | Supported |
| Generated frame names | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Frame decoding | Not applicable |
| Archive creation | Unsupported |

Synthetic fixtures cover both signatures, size derivation, offset skipping, and signature rejection.
