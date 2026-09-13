# Liar XFL resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Liar/ArcXFL.cs`, class `XflOpener`
- GARbro tag: `XFL`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The signature is the four bytes `LB` and a version word, and the whole file is a single directory at offset zero
whose end is the file's own length. A directory begins with its signature, the size of its directory region and
an entry count; its records start twelve bytes in and are forty bytes wide, holding a 32-byte name field, the
data offset relative to the region's end, and the size. The region ends where the payloads begin, and the
reference requires the records to fit inside it.

A record is not always a file. When its name ends in `.xfl` and its payload begins with the signature, the
reference recurses into it as a nested directory, and only falls back to treating it as an ordinary entry when
that recursion yields nothing — so a `.xfl` entry whose payload is not itself an archive is read normally.
Nested entries keep the path their directory was found under.

Every payload is checked against the *enclosing* region's end rather than the file's length, since a nested
directory may not reach past itself. The reference bounds neither the recursion nor those regions, so the port
caps the depth, and it rejects a blank name where the reference would carry one through. Payloads are stored
verbatim; the script format that shares the reference's file, and its archive writing support, are out of scope.

## Support

| Capability | Status |
| --- | --- |
| `LB` signature with its version word | Supported |
| Directory region size, count and record bounds | Supported |
| Records with a 32-byte name field | Supported |
| Relative data offsets and stored sizes | Supported |
| Recursion into nested `.xfl` archives | Supported |
| Nested-name fallback when a payload is not an archive | Supported |
| Region-scoped placement validation | Supported |
| Depth cap and blank-name rejection | Supported as hardenings |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a nested archive with a flat sibling, a `.xfl` entry whose payload is not an archive,
a directory whose records exceed its region, a foreign signature, and an entry that reaches past its region.
