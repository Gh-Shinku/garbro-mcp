# SH System HIM5 resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/SHSystem/ArcHXP.cs`, classes `Him5Opener` and `ShsCompression`
- GARbro tag: `HIM5`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Two signatures share the layout — `Him5` and `SHS7` — with the entry count at 4 and eight-byte section
descriptors behind it, each holding a size and an offset. A descriptor whose size is zero marks an absent
section and is skipped rather than walked.

Inside a section, entries are read until its size runs out: a one-byte length below five ends the walk, and each
entry then holds a *big-endian* data offset and a name filling the rest of the record, unlike version four where
offsets are little-endian and names are generated. The reference does not reject a blank name, while the port
does, as it does for the other formats it ports.

The size pair behind every entry — a stored size and an unpacked size, with the data behind them — is read
exactly as in version four, so both versions share that step as well as the LZ codec, which this port exports
from the version four module. Version five is also the layout that the DDSystem formats build on: their readers
reuse its section descriptor walk.

## Support

| Capability | Status |
| --- | --- |
| Both signatures | Supported |
| Count and section descriptors with zero-size skipping | Supported |
| Section entry walk bounded by the section size | Supported |
| Big-endian entry offsets | Supported |
| Names from the archive with blank rejection | Supported |
| Stored and unpacked size pair per payload | Supported |
| Plain and compressed payloads through the shared codec | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a section with a plain and a compressed payload, and a foreign signature.
