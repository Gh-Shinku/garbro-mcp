# Triangle SUD audio archive

## Reference and attribution

- GARBro reference: `ArcFormats/Triangle/ArcSUD.cs`, class `SudOpener`
- GARBro tag: `SUD`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2018 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`SUD` files carry an `OggS` tag at offset 4 and are chains of size-prefixed chunks. Each chunk
is a 32-bit size followed by that many bytes; chunks whose payload starts with `OggS` are listed
as `<index>.ogg`, and other chunks (metadata) are skipped but still advance the walk.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Size-prefixed chunk walk | Supported |
| Generated Ogg names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
