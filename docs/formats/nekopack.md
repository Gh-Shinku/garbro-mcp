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
| Version 2 dynamic MMX-style decryption | Supported |
| Version 2 duplicated-size validation | Supported |
| Version 3 | Planned separately |
| Archive creation | Unsupported |

Version 2 retains the hashed directory layout but duplicates directory counts and encrypted size
fields for validation. Its initial key generates four packed-lane transforms plus six key-register
updates. The implementation models the 8-, 16-, 32-, and 64-bit unsigned wraparound explicitly.

Synthetic fixtures cover filename-hash vectors, fixed encrypted-block vectors, resolved and
unresolved names, both encryption schemes, listing, and extraction. No real game data is used,
following the current migration policy.
