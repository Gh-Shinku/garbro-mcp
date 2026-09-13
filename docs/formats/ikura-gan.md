# IKURA GDL animation resources (GAN)

## Reference and attribution

- GARbro reference: `ArcFormats/Ikura/ArcGAN.cs`, class `GanOpener`
- GARbro tag: `GAN`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The animation archive opens with `GANM0100` and keeps a flat frame table behind a fixed area. Frames are stored
as they are, each one holding a complete picture or the changes against another frame.

## Layout

```
[u8 'GANM0100'] [u32 unused] [i32 frame count at 0xC] [0x2000 byte area]
[frame table at 0x2010] [frames]
```

The count must be sane, which means greater than zero and below 0x40000, and the table must fit into the file.

Each of the 0x10 byte table records holds:

| Offset | Field |
| --- | --- |
| 0x00 | frame id |
| 0x04 | referenced frame index, or -1 |
| 0x08 | frame offset |
| 0x0C | frame size |

Frames are named after the file with a two digit index, `name#00`, `name#01` and so on, and their type is
`image`. The two id fields are reported as entry metadata; they only matter to the reference's image decoder.

## Port notes and deviations

- `GanOpener` never overrides the plain extraction path, so an entry is handed back as its stored bytes even
  though the reference can render it as a frame.
- Frame rendering (`GanFrameArchive.GetFrame`, which resolves the referenced frame and decodes the pixels) is
  out of scope.
- Archive creation stays out of scope.

## References

- `GARbro/ArcFormats/Ikura/ArcGAN.cs` - `GanOpener.TryOpen`, `GanOpener.OpenImage`, `GanFrameArchive.GetFrame`
