# GsPack resource archive (GsPack)

## Reference and attribution

- GARbro reference: `ArcFormats/GsPack/ArcGsPack.cs`, class `PakOpener`
- GARbro tag: `GsPack`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
0x00  char[8]   'DataPack5', 'GsPack5' or 'GsPack4'
0x30  uint16    minor version
0x32  uint16    major version
0x34  uint32    packed index size, zero for a raw index
0x38  uint32    encryption flags, bit zero for the index and bit one for the payloads
0x3C  int32     entry count
0x40  uint32    data offset
0x44  int32     index offset
index           entry count records, 0x48 bytes wide before version five and 0x68 from then on
data            payloads at the data offset plus the offset recorded per entry
```

Every record starts with a 0x40 byte CP932 name. At +0x40 sits the payload offset relative to the data
offset, at +0x44 the payload size. Records with an empty name are skipped. When the index is larger than
zero it is an LZSS stream that has to unpack to `count * record width` bytes, and its bytes are complemented
with their own index first when the low encryption bit is set.

Entries whose name starts with `image` or `voice` are typed from the archive name, and remaining entries are
typed from their payload signature.

When the second encryption bit is set, payloads are XORed word by word with a key derived from the entry
name: the key starts at zero and for every character becomes `key * 37 + (character | 0x20)`, wrapping at 32
bits. Bytes behind the last complete word are left alone.

## Port notes and deviations

- Payload offsets are bounds checked, which the reference leaves to the platform.
- Image and audio decoding are out of scope, as is archive creation.

## References

- `GARbro/ArcFormats/GsPack/ArcGsPack.cs` - `PakOpener.TryOpen`, `PakOpener.OpenEntry`,
  `PakOpener.DecryptData`
