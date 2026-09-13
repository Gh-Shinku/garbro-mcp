# Will Co. game engine resource archive (ARC)

## Reference and attribution

- GARbro reference: `ArcFormats/Will/ArcWILL.cs`, classes `ArcOpener`, `ExtRecord` and `ArcOptions`
- GARbro tag: `ARC/Will`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

The archive is a table of extension records. Each record describes a group of files that share an
extension and points at its own file list.

```
+0  int32    extension record count, up to 0xFF
+4  record[] extension records, 12 bytes each
```

An extension record holds a four byte extension field, the number of files in the group and the offset
of the group's file list. The count has to be positive and at most `0xFFFF`, and the directory offset has
to be past the record itself and inside the archive.

```
+0  char[4]  extension, NUL padded and lowercased by the reader
+4  int32    file count
+8  uint32   file list offset
```

A file list is a run of fixed width records, followed by the payloads, whose offsets are absolute.

```
+0            char[nameSize]  name, NUL padded
+nameSize     uint32          payload size
+nameSize + 4 uint32          payload offset
```

## Name width

`nameSize` is not stored anywhere. The reference first parses the whole table with nine byte name fields
and, when any single record fails, retries the complete table with thirteen byte fields. The port does the
same and reports the width that worked as `nameSize` archive metadata.

A record fails when its name field is empty, when its payload is not placed inside the archive, or when
the record would run past the end of the file. Names are lowercased, and when the group's extension field
is not empty the name's extension is replaced with it, so `data` in a `WIP` group becomes `data.wip`.

## Extraction

Entries are stored verbatim, except for scripts. Files with a `.scr` or `.wsc` extension are stored with
every byte rotated left by two bits, so extraction rotates each byte right by two bits. The rotation is
length preserving, so the declared size always matches the extracted stream.

## Port notes and deviations

- Archive creation is out of scope; the reference can also write these archives and lets the caller pick
  the name width.
- Both name widths are tried exhaustively, which can accept a nine byte parse of a thirteen byte archive
  exactly like the reference does.

## References

- `GARbro/ArcFormats/Will/ArcWILL.cs` - `ArcOpener.TryOpen`, `ArcOpener.ReadFileList`,
  `ArcOpener.OpenEntry`, `ArcOpener.DecodeScript`, `ArcOpener.IsScriptFile`
- `GARbro/ArcFormats/Will/ArcPulltop.cs` - the same script rotation used by the ARC2 variant
