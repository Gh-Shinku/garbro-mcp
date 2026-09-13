# Hot Soup Processor resource archives (DPM)

## Reference and attribution

- GARbro reference: `ArcFormats/HSP/ArcDPM.cs`, classes `DpmOpener` and `DpmArchive`
- GARbro tag: `DPM`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

A standalone archive opens with `DPMX`, keeps its payloads behind the header and ends with an index of named
entries. Every entry may carry a key that decides whether its payload is decoded.

## Layout

```
[u8 'DPMX'] [u32 data base] [i32 entry count] [u32 index offset - 0x10]
[payloads] [index records]
```

The index offset is relative to the header, while entry offsets are relative to the data base. The index
follows the payloads, so `max offset - (index offset + 32 * count)` is exactly the size of the data area.

Each index record occupies 0x20 bytes:

| Offset | Field |
| --- | --- |
| 0x00 | name, 0x10 bytes, cut at its first NUL |
| 0x10 | entry key |
| 0x14 | payload offset, relative to the data base |
| 0x18 | payload size |
| 0x1C | unused |

## Entry decoding

`DpmArchive.DecryptEntry2` seeds two bytes from the entry key and then walks the payload, adding a running sum:

```
first  = 0xAA + ((key >> 16) ^ (key + 0x5A)) & 0xFF
second = 0x55 + ((key >> 24) ^ ((key >> 8) + 0xA5)) & 0xFF
value  = 0
byte i = value + (((first ^ stored[i]) - second) & 0xFF)
```

Every step depends on the stored byte in the same position, so the transform is a stream cipher over bytes
rather than a plain running sum. An entry whose key is zero is stored as it is, and the archive reports
`encrypted` for the entries that carry a key.

## Port notes and deviations

- The reference also reads archives that live in the overlay of a Windows executable. Those derive their
  seeds from a key it finds in the executable's sections, which the port does not do, so only standalone
  `DPMX` archives are detected.
- The reference has a second decoder for the older seed pair which no code path uses; the port ports only
  the one `OpenEntry` calls.
- Archive creation stays out of scope.

## References

- `GARbro/ArcFormats/HSP/ArcDPM.cs` - `DpmOpener.TryOpen`, `DpmOpener.OpenEntry`, `DpmArchive.DecryptEntry2`,
  `DpmxScheme`
