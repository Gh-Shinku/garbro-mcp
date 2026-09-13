# GsPack symbol archive (GsData)

## Reference and attribution

- GARbro reference: `ArcFormats/GsPack/ArcGsPack.cs`, class `DatOpener`
- GARbro tag: `GsData`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
0x00  char[16]  'GsSYMBOL5BINDATA'
0xA4  uint32    header size, at least 0xD0
0xA8  int32     symbol count
0xB8  uint32    packed index offset
0xBC  uint32    packed index size
0xC0  uint32    index key
0xC4  uint32    unpacked index size, the count times 0x18
0xC8  uint32    data offset
index           entry count records of 0x18 bytes behind an LZSS layer
data            payloads at the data offset plus the offset recorded per entry
```

Each record holds the payload offset at +0, the stored size at +4 and the unpacked size at +8. The packed
index is complemented with `byte_index & key` before it is unpacked, and the unpacked size has to equal
exactly `count * 0x18`.

Symbols are named with five digits and unpacked from an LZSS stream. A record with a zero stored size
extracts to nothing.

## Port notes and deviations

- The reference has no sanity bound on the symbol count; this port rejects implausible values.
- Payload offsets are bounds checked, which the reference leaves to the platform.
- Image and audio decoding are out of scope, as is archive creation.

## References

- `GARbro/ArcFormats/GsPack/ArcGsPack.cs` - `DatOpener.TryOpen`, `DatOpener.OpenEntry`
