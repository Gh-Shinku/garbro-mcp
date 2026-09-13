# Patisserie resource archives (BIN/OZ)

## Reference and attribution

- GARbro reference: `ArcFormats/Patisserie/ArcBIN.cs`, class `BinOpener`
- GARbro tag: `BIN/OZ`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive opens with the bytes `OZ 00 01` and an `OFST` marker at 0x04, and uses the `bin` extension.

## Layout

```
[u8 'OZ 00 01'] [u8 'OFST' at 0x04] [i32 index size at 0x08] [u32 payload offsets at 0x0C] [payloads]
```

The index size is a multiple of four, and the count it implies must be sane, which means greater than zero and
below 0x40000. Every table entry is the offset of one payload and the payload behind the last offset reaches
the end of the file, so an entry's stored range is the distance to the next offset. A range that runs backwards
or beyond the end of the file declines the archive.

## Payloads

A payload longer than four bytes may carry a header:

- `DFLT` holds the stored size at 0x04 and the unpacked size at 0x08, and the zlib stream starts at 0x0C;
- `DATA` holds its own size at 0x04 and the payload starts at 0x08, so it is not compressed.

Entries without either marker are stored as they are.

## Names

Names come from three places, in this order:

1. a sibling list whose name is the archive name with a `lst` extension, one name per line in CP932;
2. the shared `lists.lst` next to the archive: the archive's base name is looked up in it, and the matching
   entry of the shared `lists.bin` index holds the names, either behind a `DFLT` zlib stream or a `DATA`
   header;
3. otherwise generated names of the form `{base}#{index}` with five digits.

Entries the list does not cover keep their generated names.

## Content types and extensions

When the archive's base name ends in `flac` or `ogg`, the suffix is removed from the generated names and every
entry is marked as audio with that extension. Otherwise, a `DATA` payload whose first four bytes are a known
signature is retyped: `fLaC` marks audio with a `flac` extension, and the shared detection table covers Ogg and
RIFF payloads plus bitmaps.

## Port notes and deviations

- Every entry is reported with the size the index or its header declares, so extraction is bound to that size;
  the reference only learns the size of a plain payload from its neighbours.
- Archive creation stays out of scope.

## References

- `GARbro/ArcFormats/Patisserie/ArcBIN.cs` - `BinOpener.TryOpen`, `BinOpener.OpenEntry`,
  `BinOpener.GetFileNames`, `BinOpener.ReadFileNames`, `BinOpener.ReadListFile`
- `GARbro/GameRes/GameRes.cs` - `AutoEntry.DetectFileType`
