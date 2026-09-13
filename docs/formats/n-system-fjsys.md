# NSystem engine resource archives (FJSYS)

## Reference and attribution

- GARbro reference: `ArcFormats/NSystem/ArcFJSYS.cs`, class `FjsysOpener`
- GARbro tag: `FJSYS`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive opens with `FJSYS` and keeps a table of entries whose names live together in one blob behind the
table.

## Layout

```
[u8 'FJSYS'] ... [u32 name blob size at 0xC] [i32 entry count at 0x10] ... [entry table at 0x54]
[name blob] [payloads]
```

The count must be sane, which means greater than zero and below 0x40000. The table occupies `count * 0x10`
bytes and the name blob follows it, so both have to be inside the file.

Each record holds:

| Offset | Field |
| --- | --- |
| 0x00 | name offset inside the blob |
| 0x04 | payload size |
| 0x08 | payload offset, 64 bit |

Names are CP932 and cut at their first NUL; an offset behind the name blob declines the archive. A name that
ends in `.msd` marks a script, and an offset plus size that leaves the file declines the archive.

## Port notes and deviations

- The reference decrypts `.msd` scripts with a password it looks up in a per-title database and asks the user
  for otherwise. The port has no such database, so it lists scripts with their own type but hands back their
  stored bytes.
- The reference resolves names from a lookup table for titles it knows before falling back to the blob; that
  table is data that lives outside the format, so the port always uses the blob.
- Archive creation stays out of scope.

## References

- `GARbro/ArcFormats/NSystem/ArcFJSYS.cs` - `FjsysOpener.TryOpen`, `FjsysOpener.OpenEntry`, `MsdArchive`,
  `FjsysOpener.QueryPassword`
