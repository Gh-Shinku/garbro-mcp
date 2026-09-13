# Bishop BSA resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Bishop/ArcBSA.cs`, classes `BsaOpener` and `IndexReader`
- GARbro tag: `BSA`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The head spells `BSAr`, then carries the letter `c` as a 16-bit word, the version at 8 and the entry count
at 0xA; the index offset at 0xC must point inside the file. The version must be one to three, and versions
above one are read with the wider record layout first, falling back to the narrower reader whenever that
returns nothing — a fallback the port reproduces and that a fixture exercises with a narrow-layout file
that claims version two.

Both layouts share their directory handling. A name beginning with `>` pushes a directory level holding the
rest of that name, one beginning with `<` pops the innermost level when there is one, and anything else
names an entry, prefixed by the stack when it is not empty. Names are joined with a forward slash. Every
record, including a marker, advances by the full stride: 0x28 bytes in version one, where the name is a
0x20-byte field followed by the data offset and size, and twelve bytes in version two, where a name offset
points into a pool that trails the whole record table and runs to the end of the file.

Payloads are stored verbatim. The reference declares no compression and installs no entry decoder for this
format.

## Support

| Capability | Status |
| --- | --- |
| `BSAr` head with its marker letter | Supported |
| Version range and entry count validation | Supported |
| Index offset bound | Supported |
| Version 1 records with fixed name fields | Supported |
| Version 2 records with a trailing name pool | Supported |
| Fallback from the wider layout to the narrower one | Supported |
| Directory push and pop markers | Supported |
| Slash-joined paths | Supported |
| CP932 names | Supported |
| Entry placement validation | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover version 1 markers, version 2 name pools, the fallback path, an unsupported
version, and a missing marker letter.
