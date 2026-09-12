# Selene KCAP

## Reference and attribution

- GARBro reference: `ArcFormats/Selene/ArcKCAP.cs`, class `PackOpener`
- GARBro tag: `KCAP`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts with `KCAP`, a little-endian entry count, and 0x54-byte index records. Each record
contains a 0x40-byte CP932 path, eight reserved bytes, an absolute offset, size, and encryption flag.

Encrypted entries XOR against a 0x10000-byte repeating key table. The table seed is the standard
CRC-32 of the CP932 passphrase. GARbro's generator resembles MT19937 but intentionally uses signed
32-bit arithmetic and arithmetic right shifts. Each key byte combines the passphrase's UTF-16 code
unit with the generator's upper word. Passphrases shorter than eight characters select
`Selene.Default.Password`; callers can construct `KcapFormat` with a game-specific passphrase.

## Support

| Capability | Status |
| --- | --- |
| Signature and structural detection | Supported |
| CP932 hierarchical paths | Supported |
| Raw entry extraction | Supported |
| Default-passphrase decryption | Supported |
| Programmatically supplied passphrases | Supported |
| Archive creation | Unsupported |

The signed generator is checked against a C# GARbro-reference vector. Synthetic archives cover raw
and encrypted entries, custom passphrases, and data crossing the repeating-key boundary. No real
game data is used, following the current migration policy.
