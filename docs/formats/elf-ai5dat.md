# AI5WIN engine DAT resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/elf/ArcAi5DAT.cs`, class `DatAI5Opener`
- GARBro reference: `ArcFormats/elf/ArcAi5Win.cs`, class `Ai5ArcIndexReader`
- GARBro tag: `DAT/AI5WIN`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Unlike the other AI5WIN variants, this archive describes its own encryption. The 32-bit word at 4 is
the key: it decrypts the record count at 0 and the per-record size and offset, while the name key is
the byte at 0x23, which sits in the padding of the first name field and therefore decrypts to zero.

Records start at 8 and are `name_width + 8` bytes wide with a fixed 0x14-byte name field. GARbro
requires every payload to start behind the index. Name bytes are XORed with the name key; the name
ends at the first zero byte, must not contain control bytes, and must terminate inside the field.

## Support

| Capability | Status |
| --- | --- |
| Self-describing key detection | Supported |
| XORed record count, size, and offset | Supported |
| XORed names with validation | Supported |
| First-offset validation | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| User-supplied scheme fallback | Not applicable |
| Archive creation | Unsupported |

The sibling `ARC/AI5WIN` opener needs a user-configured scheme list and returns no archive when that
list is empty, so it is not part of this port.

Synthetic fixtures cover key recovery, name decryption, empty name rejection, and payload range
rejection.
