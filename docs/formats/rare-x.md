# Rare resource archive (X/RARE)

## Reference and attribution

- GARbro reference: `Legacy/Rare/ArcX.cs`, class `XOpener`
- GARbro tag: `X/RARE`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
seisen.exe
0x3A9A0  records  715 entries of twelve bytes each
                   uint32 offset, uint32 stored size, uint32 unpacked size
PP.X
...                payloads at the offsets the executable records
```

The archive has to be called `PP.X`, compared only against its last path component, and it carries neither a
header nor an index of its own: everything comes from the sibling `seisen.exe`. The reference hard-codes both
the position and the length of that table, so this is a single game format with a fixed entry count of 715.
Entries are named `PP#00000.BMP` upwards and typed as images.

Every entry is compressed. The payloads use a ring buffer variant that differs from the usual LZSS family:
the frame is 0x400 bytes and starts at slot one, a control bit of one introduces an eight bit literal, and a
control bit of zero is followed by a ten bit frame position and a five bit match length plus two. Copy
positions index the frame directly instead of counting backwards from the write cursor, so they have to be
read MSB first from the same bit stream.

## Port notes and deviations

- A copy whose length would exceed the declared unpacked size is truncated rather than raising, matching the
  fact that the reference relies on its own array bounds.
- Bitmap image decoding and archive creation are out of scope.

## References

- `GARbro/Legacy/Rare/ArcX.cs` - `XOpener.TryOpen`, `XOpener.OpenEntry`, `XOpener.Decompress`
