# Tactics YU resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Tactics/ArcYU.cs`, class `YuOpener`
- GARBro tag: `ARC/Tactics/0`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The payload file has a companion index whose name is the archive name plus `.dll`. Every record holds
a 0x41-byte name field whose bytes are XORed with 0x55 up to the first NUL, then a 32-bit data offset
and a content-type byte.

Records carry no sizes, so GARbro derives each size from the next offset and lets the last entry run
to the end of the archive. Payloads whose content type is 3 are XORed with the same 0x55 key on
extraction.

## Support

| Capability | Status |
| --- | --- |
| Companion `<archive>.dll` index | Supported |
| 0x55 name unmasking | Supported |
| Content-type handling | Supported |
| Derived entry sizes | Supported |
| Type 3 payload decryption | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the companion index, size derivation, type 3 decryption, and
missing-companion rejection.
