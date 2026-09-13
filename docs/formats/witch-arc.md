# Witch ARC archive

## Reference and attribution

- GARBro reference: `Legacy/Witch/ArcARC.cs`, class `ArcOpener`
- GARBro tag: `ARC/WITCH`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`ARC ` archives carry a zero 32-bit word at offset 4 and a record list from offset 0x10. Each
record starts with the eight-byte tag `DIR ` plus four NUL bytes, followed by a 32-bit unused
value, a 32-bit name length, 16 unused bytes, a 32-bit size, a 32-bit offset, and finally the
CP932 name. The walk stops at the first record whose tag does not match.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| DIR-tagged variable-length records | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
