# Dall PEL archive

## Reference and attribution

- GARBro reference: `Legacy/Dall/ArcPEL.cs`, class `PelOpener`
- GARBro tag: `PEL`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`PEL` files are detected by extension. A 16-bit entry count sits at offset 0 and records follow
immediately: a null-terminated CP932 name of at most 0x14 bytes, a 32-bit size, then the payload
itself. GARbro walks the file sequentially, so there is no separate index.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Sequential name/size/payload walk | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
