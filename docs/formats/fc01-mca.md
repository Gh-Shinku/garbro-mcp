# F&C Co. multi-frame images (MCA)

## Reference and attribution

- GARbro reference: `ArcFormats/FC01/ArcMCA.cs`, class `McaOpener`
- GARbro tag: `MCA`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

A frame archive opens with `MCA ` and keeps a table of frame offsets behind its header. Frames are images
that share one palette when the archive stores eight bit pixels.

## Layout

```
[u8 'MCA '] ... [u32 index offset at 0x10] [i32 bits per pixel at 0x14] ... [i32 frame count at 0x20]
[palette for eight bit archives] [u32 frame offsets] [frames]
```

The header occupies 0x24 bytes. The index offset must point inside the file and the count must be sane, which
means it is greater than zero and below 0x40000.

## Index

The table holds one 32-bit offset per frame. Frames are not stored with their own sizes: a frame ends where the
next one begins, and the last frame reaches to the end of the file. The reference compares every offset against
the position of its own table entry, so an offset that starts inside the table declines the archive, and the
same happens for an offset behind the end of the file.

Entries are named after the file with a four digit frame number, `name#0000`, `name#0001` and so on. The base
name comes from the archive path, which is why the port takes the source path while reading. A frame of 0x20
bytes or less is dropped and does not shift the numbering of the frames behind it.

An eight bit archive keeps a 0x400 byte palette in front of the table. The stored index offset points at the
palette, so the reader adds 0x400 before it reads the first offset.

## Port notes and deviations

- Entries carry the type `image`, matching the reference's `Entry.Type`.
- The reference decodes frames with a key the user supplies in the GUI and has no plain extraction path; the
  port hands back the stored frame instead and reports `MCA` decoding as unsupported.
- Archive creation stays out of scope.

## References

- `GARbro/ArcFormats/FC01/ArcMCA.cs` - `McaOpener.TryOpen`, `McaOpener.OpenImage`, `McaArchive`
