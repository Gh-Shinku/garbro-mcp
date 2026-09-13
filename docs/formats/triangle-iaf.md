# route2 IAF multi-frame image

## Reference and attribution

- GARBro reference: `ArcFormats/Triangle/ArcIAF.cs`, class `IafOpener`
- GARBro tag: `IAF/MULTI`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`IAF` files are detected by extension and are a chain of frames. Each frame starts at an
unaligned offset: a 32-bit packed size at +1 and 0x19 bytes of header before the payload, so
the frame size is `packedSize + 0x19`. Frames are named `<basename>#NNN.IAF`.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Unaligned frame chain | Supported |
| Generated frame names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
