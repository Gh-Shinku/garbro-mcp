# Yuka engine resource archives (YKC)

## Reference and attribution

- GARBro reference: `ArcFormats/Yuka/ArcYKC.cs`, class `YkcOpener`
- GARBro tag: `YKC`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive starts with the signature `YKC0` and a version word, keeps its payloads and names first and ends with
a record index. Script payloads are stored with their text xored behind a small header, which the reader undoes
when it hands the entry out.

## Layout

```
[u8 'YKC0'] [u8 version] [2 zero bytes] [8 unused bytes] [u32 index offset] [u32 index length]
[entry payloads]
[entry names]
[u32 name offset] [u32 name length] [u32 offset] [u32 size] [u32 unused]  (per entry)
```

The version word is the two byte string `01` or `02` followed by two zero bytes, so the reader can compare it
with a single little endian word. Version one stores names as shift-jis, version two as utf-8. The entry count is
the index length divided by the twenty byte record size, so trailing bytes that do not fill a record are
ignored. The index must fit inside the file and every record is checked against the file size before its name is
read; names are read afterwards so that no name lookup happens for a rejected archive. The reference is
hierarchical, so names may contain directory separators and are normalized on listing.

## Script payloads

A payload is treated as a script when its size is at least 0x24 bytes, its name ends in `.yks`, it starts with
the magic `YKS001` and the word at offset six is one. The reader then xors every byte from the text offset stored
at 0x20 to the end of the payload with 0xAA and clears the version word at offset six. Everything else is handed
out as it is stored.

## Port notes and deviations

- A name that leaves the file declines the archive, while the reference lets its view throw. The reference
  writes archives as well (`CanWrite` is true); creation is out of scope for this port.
- A trailing index length that is not a multiple of the record size keeps its truncated entry count, which is
  what the reference's integer division does.
- Text offsets that point past the end of a script leave it unchanged, matching the reference loop.

## References

- `GARbro/ArcFormats/Yuka/ArcYKC.cs` - `YkcOpener`, `YukaEntry`, `TryOpen`, `OpenEntry`, `Create`
