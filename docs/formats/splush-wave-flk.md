# Splush Wave resource archives (DAT/FLK)

## Reference and attribution

- GARbro reference: `Legacy/SplushWave/ArcDAT.cs`, classes `DatOpener` and `FlkEntry`
- GARbro tag: `DAT/FLK`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
[u8 'FLK'] [u32 archive size at 0x14] [i32 count at 0x18] [records from 0x20] [payloads]
```

The archive size has to match the file exactly. The records are

| Offset | Field |
| --- | --- |
| 0x00 | payload offset |
| 0x04 | payload size |
| 0x0F | entry flags, bit zero marks a packed payload |

Names are generated from the archive name: `NAME#0000`, `NAME#0001` and so on. When the first four bytes of a
payload spell `SWG`, either at the start or one byte in, the entry is typed as an image.

## Payload codec

The packed form is a 0x400 byte frame that starts at 0x3BE. Control bits are consumed from the least
significant bit of a byte and refilled with the 0x100 marker, so one control byte covers eight decisions: a
clear bit copies one literal byte into the frame, and a set bit reads two bytes whose low bits are a frame
offset, `low + ((high & 0xC0) << 2)`, and whose high bits plus three are a length, `(high & 0x3F) + 3`. Copies
move through the frame byte by byte, so they can run over the bytes they just wrote.

## Port notes and deviations

- The index declares the stored size only, so packed entries are reported with an unknown output size.
- Image decoding of the payloads, the `SWG` format, is out of scope, as is archive creation.
- The port grows its output in frame sized chunks instead of the fixed buffer of the reference.

## References

- `GARbro/Legacy/SplushWave/ArcDAT.cs` - `DatOpener.TryOpen`, `DatOpener.OpenEntry`, `DatOpener.LzssUnpack`
