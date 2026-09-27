# Groover resource archives (DAT/PCG)

## Reference and attribution

- GARbro reference: `ArcFormats/Groover/ArcPCG.cs`, class `DatOpener`
- GARbro tag: `DAT/PCG`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

The archive itself has no header and no signature: it is a plain sequence of payloads whose offsets only the
companion index knows. That index is a sibling file named after the archive with its trailing digits removed,
so `GAME01.dat` looks for `GAME.pcg` and then for `GAME.spf`; an archive whose name does not end in a digit is
not one of these, and neither is a file that is not a `dat`.

```
[part count 4] [entry count 4] [part names from 0x08] [first indexes from 0x148] [last indexes from 0x170]
[records from 0x198]
```

The part names are thirty two byte fields; the parts they describe are the individual `dat` files of a set. The
entry size is derived from the index: `(index size - 0x198) / count`, and it has to be at least 0x30. The
archive opens its own part only, from its first index up to but not including its last one; the range has to sit
inside the entry count.

Every record is:

| Offset | Field |
| --- | --- |
| 0x00 | name, 0x20 bytes, or 0x40 when the entry size is at least 0x48 |
| name size | payload offset, absolute in the archive |
| name size + 4 | payload size |

## Port notes and deviations

- The reference finds the companion through the virtual file system and compares part names literally; the port
  reads the sibling file and keeps the same literal comparison.
- `DatOpener.OpenImage` reads a payload of the archive: a payload opening with `NCMP` stands of a picture of this
  engine whose places stand of three places of a colour to a pixel as the file holds them, a payload opening with
  `RCB\0` stands of a run of three places of a colour and the count of the times they stand again, and a payload
  opening with a picture of a format stands of a walk of the formats. Both pictures of the engine carry their width
  and height at eight, the count of the places of their picture at sixteen and the count of the places of the file
  at twenty. The port stands of the picture walks of the formats this project carries - a portable network graphic,
  a JPEG and a bitmap - and hands a picture of three places of a colour over, so a picture of four places of a
  colour stands of its three places of colour alone; a payload of none of them stands turned away on extraction.
- Archive creation is out of scope.
- An archive whose companion is missing cannot be listed, so it is not detected at all.

## References

- `GARbro/ArcFormats/Groover/ArcPCG.cs` - `DatOpener.TryOpen`, `DatOpener.OpenImage`
