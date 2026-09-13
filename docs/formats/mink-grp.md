# Mink GRP archive

## Reference and attribution

- GARBro reference: `Legacy/Mink/ArcMINK.cs`, class `GrpOpener`
- GARBro tag: `GRP/MINK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A Mink archive starts with a 32-bit record count and the index offset at 4, which must be at least 8.
Records are 0x20 bytes wide: a 0x18-byte CP932 name, a 32-bit data offset at +0x18, and a 32-bit
size at +0x1c. Blank names and out-of-range entries are rejected. The format is registered for files
without an extension.

Scripts named `*.msc` are stored with an obfuscated body. When a payload starts with `MADSCR`, GARbro
reads the 16-bit script id at +8, looks it up in its hardcoded key table, and XORs every byte from
0x20 with the matching key. Ids outside that table are returned unchanged.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| 0x20-byte index records | Supported |
| Blank name rejection | Supported |
| `MADSCR` script detection | Supported |
| Hardcoded script key table | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, script decryption, unknown script ids, and blank name
rejection.
