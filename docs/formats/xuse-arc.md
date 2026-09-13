# Xuse/Eternal resource archive (ARC/Xuse)

## Reference and attribution

- GARbro reference: `ArcFormats/Xuse/ArcXuse.cs`, class `ArcOpener`
- GARbro tag: `ARC/Xuse`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
0x00  char[4]   'MIKO' or 'XARC'
0x0A  uint16    0x1001
0x0C  int32     archive mode, only (mode & 0xF) == 0 is supported
0x10  int32     entry count
0x16  char[4]   'DFNM'
0x1A  int64     offset of the CADR offset table
0x24  char[4]   'NDIX'
0x2A  index     count records of 8 bytes, each starting with a uint32 name offset
...   char[4]   'CTIF'
...   names     per entry: uint16 0x1001, uint16 length at +6, name at +0xA
CADR            char[4] 'CADR' followed by count int64 data offsets
data            per entry: char[4] 'DATA', uint32 payload size at +0x18
```

The index records point at per-entry name records elsewhere in the file, so the name field is not part of the
index. Names are complemented with 0x56 and decoded as CP932.

Each entry's data offset comes from the CADR table and points at a `DATA` record whose size field describes the
payload; the payload itself starts 0x1E bytes into that record.

## Port notes and deviations

- Archive modes other than zero are rejected by the reference with an exception; this port declines the file
  instead so that the format does not abort detection.
- Names become entry paths through the shared normalisation helper, and entry types follow the file extension.
- Image decoding and archive creation are out of scope.

## References

- `GARbro/ArcFormats/Xuse/ArcXuse.cs` - `ArcOpener.TryOpen`
