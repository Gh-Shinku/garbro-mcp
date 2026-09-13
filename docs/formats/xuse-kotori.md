# Xuse/Eternal audio archive (KOTORI/Xuse)

## Reference and attribution

- GARbro reference: `ArcFormats/Xuse/ArcXuse.cs`, class `KotoriOpener`
- GARbro tag: `KOTORI/Xuse`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
0x00  char[6]   'KOTORI'
0x06  int32     0x1A1A00
0x10  int32     0x0100A618
0x14  uint16    entry count
0x18  index     count records of 6 bytes, each starting with a uint32 data offset
...   data      payload records
```

The index is a plain offset table; each entry spans from its own offset to the next one, and the last entry
runs to the end of the file. Entries are named `NAME#0000.ogg`, based on the archive name, and typed as audio.

Records whose size is at least 0x32 bytes are treated as packed with an unpacked size of that size minus 0x32.
When such a record begins with `KOTORi`, an int32 0x001A1A00 at +6 and an int32 0x0100A618 at +0x10, the payload
is XORed with the 0x10 byte key stored at +0x20, starting at +0x32. Anything else is returned verbatim, which is
why the reported size is only a hint for this format.

## Port notes and deviations

- Entry sizes are reported as known-but-unverified, since the plain payload case returns more bytes than the
  declared size.
- Audio decoding and archive creation are out of scope.

## References

- `GARbro/ArcFormats/Xuse/ArcXuse.cs` - `KotoriOpener.TryOpen`, `KotoriOpener.OpenEntry`
