# Archangel engine scripts archive (SCN/ARCH)

## Reference and attribution

- GARbro reference: `ArcFormats/Seraphim/ArcSCN.cs`, class `Scn95Opener`
- GARbro tag: `SCN/ARCH`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
0x00  uint32    size of the table that follows, also the entry count times four
0x04  sizes     one uint32 stored size per script
...   scripts   starting right behind the table
```

As with its sibling `SERAPH/SCN`, only `SCNPAC.DAT` is accepted and the name is compared against the last
path component without regard to case. The table size has to stay inside the file, define a sane entry count
and the entries have to follow each other without a gap, each with a non zero size. Scripts are named with
five digits and typed as scripts.

Extraction runs the shared ArchAngel script decompressor, inflating a zlib layer first when the script's
signature has a `0x78` low byte, and falls back to the stored bytes when the stream does not decode.

## Port notes and deviations

- Unlike `SERAPH/SCN` this variant has no marker based zlib shortcut.
- Archive creation is out of scope.

## References

- `GARbro/ArcFormats/Seraphim/ArcSCN.cs` - `Scn95Opener.TryOpen`, `Scn95Opener.OpenEntry`
