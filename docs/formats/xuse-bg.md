# Xuse bitmap archives (BG/Xuse)

## Reference and attribution

- GARbro reference: `ArcFormats/Xuse/ArcNT.cs`, class `BgOpener`
- GARbro tag: `BG/Xuse`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
[record] [record] ...
```

There is no header at all: the archive is a sequence of equally sized bitmap records, and everything is derived
from the file name and the file size. The name has to start with `bg00` or `sbg`, without regard to case, and
the file size has to divide by the record size without a remainder, which also has to leave a sane record
count.

The record size is 0x4B400, or 0x96400 when the very first character of the name is a lowercase `s`. The
reference compares that character literally, so a name in upper case keeps the smaller record even though the
prefix check itself ignores case.

Records are named `NAME#0000`, `NAME#0001` and so on, with the name including its extension, and every entry is
typed as an image.

## Port notes and deviations

- Image decoding, which for this format is an indexed bitmap with a palette at the end, is out of scope, as is
  archive creation.

## References

- `GARbro/ArcFormats/Xuse/ArcNT.cs` - `BgOpener.TryOpen`, `BgOpener.OpenImage`, `BgImageDecoder`
