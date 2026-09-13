# UK2 engine DLB archive (version 1.00)

## Reference and attribution

- GARBro reference: `Legacy/AyPio/ArcDLB.cs`, class `DlbOpener`
- GARbro tag: `DLB`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

This version spells out its identity: the file begins with `<< dlb file Ver1.00>>` followed by a null
byte, which is the signature GARbro matches, and the entry count sits at 0x16, right after it. The
index starts at 0x18.

Every record is a fixed 0xD-byte name field followed by the data offset and the size. The name field is
fixed because GARbro's `ReadCString` always advances by the requested length, whether or not the string
terminates earlier, which pins the record width at 0x15 bytes. Payloads are stored verbatim and offsets
are absolute, so the reader only checks placement against the file length.

## Support

| Capability | Status |
| --- | --- |
| Header signature `<< dlb file Ver1.00>>` | Supported |
| Entry count validation | Supported |
| Fixed 0xD-byte name fields with a 0x15-byte record | Supported |
| CP932 filenames | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a two-entry archive and a broken header. The sibling zero version, which has no
signature and pins its record width through an aligned first offset, has its own note.
