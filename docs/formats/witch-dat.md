# Witch DAT resource archive

## Reference and attribution

- GARBro reference: `Legacy/Witch/ArcDAT.cs`, class `DatOpener`
- GARBro tag: `DAT/MK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `MK\x14\x00` file stores a 32-bit record count at 4 and records from offset 8. Every record starts
with a 32-bit name length, followed by the name, then a 16-byte tail: the image width, the height,
the stored size, and the data offset. GARbro rejects a zero name length and any entry outside the
file.

Entry types are images and the reference implementation exposes the stored dimensions with an
eight-bit depth. The payload is decoded by a separate PCD decoder, so extraction returns the stored
bytes unchanged.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Length-prefixed name records | Supported |
| Image metadata (width, height, bpp) | Supported |
| Zero name length rejection | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| PCD pixel decoding | Not applicable |
| Archive creation | Unsupported |

Synthetic fixtures cover the record layout, name decoding, metadata, zero name length rejection, and
entry placement rejection.
