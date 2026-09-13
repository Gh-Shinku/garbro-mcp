# Tigerman Project CHR compound image

## Reference and attribution

- GARBro reference: `Legacy/Tigerman/ArcCHR.cs`, class `ChrOpener`
- GARBro tag: `CHR/TIGERMAN`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`CHR` files start with the 32-bit value `0x1b1` that doubles as the offset of the `ZT` tag
and the first frame. The size of the first frame is stored at offset 4. From offset 12 up to
the `ZT` offset the file holds 0x24-byte records with a 32-bit offset and a 32-bit size; a zero
offset marks an unused slot. Frames are named `<basename>#N.ZIT`.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| ZT-tagged first frame | Supported |
| Unused record slot skipping | Supported |
| Generated ZIT frame names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
