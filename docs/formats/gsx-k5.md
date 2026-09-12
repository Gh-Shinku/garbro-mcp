# GSX K5 archive

## Reference and attribution

- GARBro reference: `Legacy/Gsx/ArcK5.cs`, class `K5Opener`
- GARBro tag: `K5`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`K5` archives start with the bytes `4B 35 01 00` (`K5` plus a version byte). A 32-bit entry
count sits at offset 4 and a 32-bit index pointer at offset 8. Each 0x100-byte record holds a
UTF-16LE directory name (0x80 bytes), a UTF-16LE file name (0x40 bytes), a 32-bit absolute
offset at +0xc8, and a 32-bit size at +0xcc. Directory and file names are joined with a
backslash.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| UTF-16LE names | Supported |
| Directory joining | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
