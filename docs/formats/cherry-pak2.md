# Cherry Soft PACK 2 resource archives (PAK/CHERRY2)

## Reference and attribution

- GARbro reference: `ArcFormats/Cherry/ArcCherry.cs`, class `Pak2Opener`
- GARbro tag: `PAK/CHERRY2`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
[u8 'CHERRY PACK 2.0' or 'CHERRY PACK 3.0'] [i32 compressed at 0x10] [i32 count at 0x14]
[u32 base offset at 0x18] [index] [payloads]
```

The version is the digit at 0x0C of the marker. The record layout is the one of `PAK/CHERRY`, including the
`GRP` renaming, and the payload offsets stay relative to the base offset.

The header is validated as it stands and, when that fails, once more with two constant keys applied to the
count and to the base offset: `0xBC138744` and `0x64E0BA23`. A second failure declines the archive. Version
two archives that are not compressed have to place their index directly behind the header, at `0x1C + count *
0x18`.

## Compression and encryption

When the compressed flag is set the region between 0x1C and the base offset is a keyed lzss stream that unpacks
to `count * 0x18` bytes of index. The keying swaps every byte pair and keys the two halves with `0x33` and
`0xCC`.

An archive whose header needed the constant keys and whose index is compressed also has keyed payloads. Those
are never script payloads: the three words at 0, 4 and 0x10 are keyed with `0xA53CC35A`, `0x35421005` and
`0xCF42355D`, and every byte pair from 0x18 on is keyed like the index.

## Port notes and deviations

- Archive creation stays out of scope.

## References

- `GARbro/ArcFormats/Cherry/ArcCherry.cs` - `Pak2Opener.TryOpen`, `Pak2Opener.Decrypt`, `Pak2Opener.OpenEntry`
