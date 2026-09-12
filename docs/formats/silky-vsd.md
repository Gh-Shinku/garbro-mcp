# AI5WIN VSD video file

## Reference and attribution

- GARBro reference: `ArcFormats/elf/ArcVSD.cs`, class `VsdOpener`
- GARBro tag: `VSD/AI5WIN`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`VSD` files start with the ASCII signature `VSD1` followed by a 32-bit skip value. The video
stream begins at `8 + skip` and runs to the end of the file. GARbro exposes a single entry named
`<basename>.mpg` with type `video`.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Single MPG stream extraction | Supported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
