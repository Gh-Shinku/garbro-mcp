# Valkyria AM2 multi-frame image

## Reference and attribution

- GARBro reference: `ArcFormats/Valkyria/ArcAM2.cs`, class `Am2Opener`
- GARBro tag: `AM2`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`AM2` files are detected by extension. Offset 0 stores a 32-bit value and offset 4 an entry
count; the payload base is `value + 12`. The frame index begins at offset 12 and uses 0x0c-byte
records with a 32-bit base-relative offset and a 32-bit size. Frames are named
`<basename>#0000.MG2`, `<basename>#0001.MG2`, ...

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Base-relative frame offsets | Supported |
| Generated MG2 frame names | Supported |
| Entry listing and extraction | Supported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
