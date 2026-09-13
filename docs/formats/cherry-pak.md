# Cherry Soft PACK resource archives (PAK/CHERRY)

## Reference and attribution

- GARbro reference: `ArcFormats/Cherry/ArcCherry.cs`, classes `PakOpener` and `CherryPak`
- GARbro tag: `PAK/CHERRY`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
[i32 count at 0x00] [u32 base offset at 0x04] [records] [payloads]
```

The format has no signature, so the count has to be sane and the base offset has to be exactly `8 + count *
0x18`, which is where the records end and the payloads begin. Every record is:

| Offset | Field |
| --- | --- |
| 0x00 | name, at most sixteen bytes |
| 0x10 | payload offset relative to the base offset |
| 0x14 | payload size |

An empty name declines the archive, and every payload has to fit inside the file.

An archive whose base name ends in `GRP`, without regard to case, holds Cherry image groups: those entries are
renamed to the `grp` extension and typed as images.

## Script payloads

Payloads that begin with `GsWIN SC File` keep a text region behind a key. `OpenEntry` reads a text offset
relative to 0x68 from 0x5C and a text size from 0x60; when the size is zero or the region leaves the entry the
payload is returned as it is, and otherwise every byte of the region is keyed with its own index.

## Port notes and deviations

- Archive creation stays out of scope.

## References

- `GARbro/ArcFormats/Cherry/ArcCherry.cs` - `PakOpener.TryOpen`, `PakOpener.ReadIndex`, `PakOpener.OpenEntry`
