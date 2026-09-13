# Spiel CGD image collection

## Reference and attribution

- GARBro reference: `Legacy/KApp/ArcCGD.cs`, class `CgdOpener`
- GARBro tag: `CGD/SPIEL`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A collection starts with the `spiel100` signature and a 32-bit record count at 8. Records begin at
0x10 and are 0x10 bytes: the data offset, the stored size, the image width at +8, the height at
+0x0a, the bit depth at +0x0e, and the compression method at +0x0f.

Entries are named `<archive>#<n padded to 4>` and the port exposes the stored dimensions, bit depth,
compression method, and derived unpacked size as metadata. The payload is decoded by a dedicated CGD
decoder, so extraction returns the stored bytes.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| 0x10-byte image records | Supported |
| Image metadata (dimensions, bpp, compression) | Supported |
| Generated entry names | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| CGD pixel decoding | Not applicable |
| Archive creation | Unsupported |

Synthetic fixtures cover the record layout, metadata, signature rejection, and entry placement
rejection.
