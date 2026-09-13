# Witch image archives (PCD/IMAGE)

## Reference and attribution

- GARbro reference: `Legacy/Witch/ArcPCD.cs`, class `ImageDataOpener`
- GARbro tag: `PCD/IMAGE`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive opens with `IMAGEDATE ` and holds a list of frames that share one payload area. Names are stored
with every byte complemented.

## Layout

```
[u8 'IMAGEDATE '] [u16 unused] [i32 frame count at 0xA] [records at 0xE]
[payload regions]
```

The count must be sane, which means greater than zero and below 0x40000.

Each record is variable length:

| Field | Layout |
| --- | --- |
| rectangle | 0x18 bytes with left at 0x8, top at 0xC, right at 0x10 and bottom at 0x14 |
| name | `[i32 length] [bytes]`, both complemented |
| frame name | `[i32 length] [bytes]`, both complemented |
| payload offset | `[u32]` |

The first eight bytes of the rectangle are not read. A name length of zero or less declines the archive, and a
name offset that leaves the file does too. Every byte of both strings is complemented with `0xFF` before it is
decoded as CP932 and cut at its first NUL.

A frame name other than `NO NAME` is appended to the name with a slash, after every slash inside the frame name
has been replaced with its fullwidth form.

## Frame sizes

Sizes are not stored. The size of a frame is the distance to the frame behind it, and the last frame reaches to
the end of the file. This relies on the record order matching the payload order; the port declines an archive
whose offsets are not strictly increasing.

The first 0x20 bytes of a frame are a header that holds its format id at 0 and its unpacked size at 4:

| Format | Payload |
| --- | --- |
| 0 | stored behind the 0x20 byte header |
| 1 | zlib stream behind the header |
| 2 | bzip2 stream behind the header |
| other | the whole frame including its header |

A frame shorter than 0x20 bytes is reported with the unknown format, which hands back the stored frame.

## Port notes and deviations

- The image decoder (`PsdFormatDecoder`) is out of scope, so entries are reported as images but their payloads
  are extracted rather than rendered.
- bzip2 is not decoded; a frame of that kind fails extraction with an unsupported-feature error while its
  declared size still shows up in the listing.
- The reference reads its index through its view without bounds checking; the port declines an index or a
  payload that leaves the file.
- Archive creation stays out of scope.

## References

- `GARbro/Legacy/Witch/ArcPCD.cs` - `ImageDataOpener.TryOpen`, `ImageDataOpener.OpenEntry`,
  `ImageDataOpener.DecryptName`, `ImageDataOpener.SetAdjacentEntriesSize`
