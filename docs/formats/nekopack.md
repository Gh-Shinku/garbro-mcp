# NekoPack

## Reference and attribution

- GARBro reference: `ArcFormats/Nekopack/ArcNEKO.cs`, class `Pak1Opener`
- GARBro tag: `NEKOPACK/1`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015-2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Version 1 structure

Version 1 begins with `NEKOPACK`. The header supplies a filename-hash seed and an encrypted index
block. The index groups files by hashed directory name and stores a filename hash and byte size for
each entry. Entry blocks have their own key and size header. Indexes and entries use a chained
64-bit transform whose four 16-bit lanes advance independently.

The built-in GARBro directory candidates are included. Applications can pass filename candidates
to `NekoPack1Format`; unresolved hashes are exposed as stable eight-digit hexadecimal names. This
replaces GARBro's optional external `nekopack.lst` integration without coupling the core parser to a
global resource catalog.

## Support

| Capability | Status |
| --- | --- |
| Version 1 detection | Supported |
| Encrypted index decoding | Supported |
| Encrypted entry extraction | Supported |
| Known directory recovery | Supported |
| Injected filename candidate recovery | Supported |
| Hexadecimal fallback names | Supported |
| Versions 2 and 3 | Planned separately |
| Archive creation | Unsupported |

Synthetic fixtures cover GARBro filename-hash vectors, a fixed encrypted-block vector, resolved and
unresolved names, listing, and extraction. No real game data is used, following the current
migration policy.
