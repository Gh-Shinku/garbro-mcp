# HDL engine resource archive

## Reference and attribution

- GARBro reference: `Legacy/Hdl/ArcHOT.cs`, class `HotOpener`
- GARBro tag: `DAT/HOT`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `HOT` archive starts with the signature, a reserved word at 4 that must be zero, the offset table
position at 8, and a 32-bit record count at 0x0c. The payloads come first and the offset table closes
the file, so every recorded offset points behind the table start once the 0x20-byte file header is
added.

GARbro derives each size from the next recorded offset, and the last entry runs to the end of the
offset table, which means it covers the table bytes as well. Entry names are generated as
`<archive>#<n padded to 5>`; GARbro assigns types from payload signatures, and the port keeps the
stems because it has no resource-type catalog.

## Support

| Capability | Status |
| --- | --- |
| Signature and reserved word detection | Supported |
| Trailing offset table | Supported |
| 0x20 header bias | Supported |
| Derived entry sizes | Supported |
| Entry placement validation | Supported |
| Generated entry names | Supported |
| Entry type inference | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover the offset table, derived sizes, reserved word rejection, and table bounds
rejection.
