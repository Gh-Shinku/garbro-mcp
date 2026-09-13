# Astronauts GXP resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Astronauts/ArcGXP.cs`, class `PakOpener`
- GARBro tag: `GXP`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `GXP` archive stores a record count at 0x18 and a 64-bit data base at 0x28; records start at 0x30.
Each record begins with its own length, obfuscated by a key word derived from the shipped 23-byte
key table, and the record body is decrypted with `byte ^ (position ^ key[position % 23])`.

The decrypted body holds the stored size at +4, a 16-bit name length in UTF-16 characters at +0x0c,
a 64-bit data offset at +0x18 relative to the data base, and a UTF-16LE name at +0x20. Payloads use
the same decryption as the records, so extraction keeps the declared size.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Length obfuscation key word | Supported |
| Position-dependent record decryption | Supported |
| UTF-16 names | Supported |
| 64-bit relative data offsets | Supported |
| Payload decryption | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the keyed records, UTF-16 names, payload decryption, and signature
rejection.
