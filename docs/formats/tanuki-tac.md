# TanukiSoft resource archive (TAC)

## Reference and attribution

- GARbro reference: `ArcFormats/TanukiSoft/ArcTAC.cs`, class `TacOpener`
- Blowfish: `ArcFormats/Blowfish.cs`
- GARbro tag: `TAC`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
0x00  char[4]   'TArc'
0x04  char[4]   '1.00' or '1.10'
0x14  int32     entry count
0x18  int32     bucket count
0x1C  uint32    packed index size
0x20  uint32    archive seed
index           Blowfish protected zlib stream starting at 0x24 for version 1.00 and 0x2C otherwise
data            payloads at the index end plus the offset recorded per entry
```

The packed index is deciphered with the ASCII key `TLibArchiveData` over whole eight byte blocks, with the
checksum and version dependent header placed in front of it. Its plaintext holds the bucket table first,
then one record per entry.

Buckets are eight bytes: a 16 bit hash, a 16 bit member count and a 32 bit first entry index. Entry records
are 24 bytes: a 64 bit hash, a 32 bit packed flag, the unpacked size, the payload offset and the payload
size. For every bucket member the recorded hash keeps its high 48 bits and receives the bucket hash in its
low 16 bits, which yields the hash used for the name and the decryption key.

Entries are named after their hash, `{0:X16}`. GARbro resolves friendly names through a game side
`tanuki.lst` list, which is not part of an archive.

Packed entries hold a zlib stream and extract to their recorded unpacked size. All other entries are
Blowfish protected with the key `{hash}_tlib_secure_`, where the hash is written in decimal. Image entries
are typed from the deciphered first block and only keep their first 10240 bytes encrypted, everything else
is stored in the clear; entries whose size is not a multiple of eight keep a trailing partial block.

## Port notes and deviations

- The `tanuki.lst` name list is unavailable, so every entry keeps its hash based name and its type comes
  from the deciphered signature alone. Image entries whose name ends in `.af` therefore cannot be
  recognised as such.
- `TacOpener.HashFromAsciiString` is not reproduced, it only serves the missing name list.
- The bucket count of the reference is unvalidated; this port requires it to be non-negative and bounded.
- GARbro's byte level `Decipher` reads and writes little-endian halves while its `Encipher` helper switches
  to big-endian, so the two are not inverses. This port uses the little-endian `Decipher` semantics.
- Image decoding is out of scope, as is archive creation.

## References

- `GARbro/ArcFormats/TanukiSoft/ArcTAC.cs` - `TacOpener.TryOpen`, `TacOpener.OpenEntry`
- `GARbro/ArcFormats/Blowfish.cs` - `Blowfish.Decipher`, `BlowfishDecryptor`
