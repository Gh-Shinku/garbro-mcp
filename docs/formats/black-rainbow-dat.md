# BlackRainbow DAT archive

## Reference and attribution

- GARBro reference: `ArcFormats/BlackRainbow/ArcDAT.cs`, class `DatOpener`
- GARBro tag: `DAT/BR`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A BlackRainbow archive stores a 32-bit record count at 8 and a base offset at 0x0c. The index starts
at 0x10 and holds 32-bit relative offsets; the value `0xffffffff` marks a skipped slot, every other
value is added to the base offset. GARbro sorts the resulting absolute offsets before walking them.

Each entry starts with a 0x24-byte CP932 name field, which is followed by the payload. An entry runs
up to the next recorded offset, and the last one to the end of the file. When the name field is
empty, GARbro generates `<n>_<archive>#<n>` with the index position padded to two digits and appends
`.bmd` when the payload starts with `_BMD`.

The descriptor is registered for the `dat` and `pak` extensions, matching GARbro's dispatch.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Base-offset relative index | Supported |
| `0xffffffff` slot skipping | Supported |
| Offset sorting | Supported |
| Generated names for anonymous entries | Supported |
| `_BMD` marker detection | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index conversion and sorting, skipped slots, generated names, the
`_BMD` marker, and base offset rejection.
