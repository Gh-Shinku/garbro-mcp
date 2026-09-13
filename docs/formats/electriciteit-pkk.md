# Electriciteit PKK resource archive

## Reference and attribution

- GARBro reference: `Legacy/Electriciteit/ArcPKK.cs` (`PkkOpener`) with `ByteStringEncryptedStream`
  from `ArcFormats/SimpleEncryption.cs`
- GARbro tag: `PKK`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Everything in this archive is encrypted with one 0x200-byte key that repeats and restarts at its first
byte for each buffer, making the cipher a plain repeating-key XOR. GARbro registers two signatures,
which are simply the two encrypted forms of the header's version word.

The first 0x14 bytes decrypt to a header holding that version word at 0, the index offset at 0xC, and
the entry count at 0x10. The version must be zero or one, the index offset must sit at or behind the
header and inside the file, and the count is bounded at 0xFFFFF.

The index then follows at that offset as `count` records of 0x28 bytes, decrypted as a unit so its key
also starts over. A record leaves its first eight bytes alone, holds the stored size at 0 and a data
offset relative to the end of the index at 4, and carries a null-terminated CP932 name of at most 0x20
bytes at 8.

Payloads repeat the same XOR from the key's first byte, because the reference wraps them in
`ByteStringEncryptedStream` with a base position of zero, so extraction inverts the stream the header
used. The length never changes, so entry sizes stay exact.

## Support

| Capability | Status |
| --- | --- |
| Encrypted signature matching (both version words) | Supported |
| Version word limited to zero or one | Supported |
| Index offset and entry count validation | Supported |
| 0x28-byte records with names at 8 | Supported |
| CP932 names with blank rejection | Supported |
| Entry placement validation | Supported |
| Repeating-key XOR over header, index and payloads | Supported |
| `pkk` and `skn` extensions as hints | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover both accepted version words, header, index and payload decryption, an unknown
version word, and an index offset pointing inside the header.
