# MAI resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/MAI/ArcMAI.cs`, class `ArcOpener`
- GARbro tag: `MAI`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The head spells `MAI` with a 0x0A byte, the word at 4 repeats the file's own size and must match it, and the
entry count sits at 8. A level byte at 0x0D and a folder count at 0x0E follow, and the index at 0x10 holds
the file records first and the folder records behind them, which is why both counts are needed to size it.

A file record is a 0x10-byte name field, the data offset and the size. A folder record is only read when the
level byte is two and at least one folder is announced: a four-byte name and an index saying where the
folder starts. The reference walks the entry list while advancing the current folder whenever the entry
index reaches the next folder's index, so a folder governs every entry from its own index until the next
folder takes over, and the last folder stays in effect to the end; entries take the folder as a path prefix.

GARbro resolves each entry's type lazily through an `AutoEntry` that consults its resource catalog and, for
an archive named `mask.arc`, its own mask format; the port records an inferred type from the extension and
does not special-case that file name. Payloads are stored verbatim and a blank name rejects the archive.

## Support

| Capability | Status |
| --- | --- |
| `MAI` signature with its trailing byte | Supported |
| File size cross-check | Supported |
| Entry count validation | Supported |
| Index covering file records plus folder records | Supported |
| Folder level and count handling | Supported |
| Folder name prefixing from a folder's own index | Supported |
| Entry placement validation | Supported |
| CP932 names with blank rejection | Supported |
| Type classification by extension | Supported as metadata |
| `mask.arc` special case | Not ported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover an archive with a folder starting mid-list, an archive without folders, a
mismatched size word, an empty count, and the extension requirement.
