# Seraphim engine scripts archive (SERAPH/SCN)

## Reference and attribution

- GARbro reference: `ArcFormats/Seraphim/ArcSCN.cs`, class `ScnOpener`
- GARbro tag: `SERAPH/SCN`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
0x00  int32     script count
0x04  offsets   count + 1 uint32 offsets, the last one closing the final script
...   scripts
```

Only a file named `SCNPAC.DAT` is accepted, compared against its last path component without regard to
case. The first offset has to point behind the offset table, offsets have to grow, and the closing offset has
to stay inside the file. Scripts are named with five digits, starting at `00000`, and typed as scripts.

Extraction is two layered: a payload of four bytes `01 00 00 00` followed by `0x78` is a zlib stream whose
output is returned as is, otherwise a payload whose first word is below four or whose top byte is set is
checked for a `0x78` low byte and inflated before the script pass. The script pass itself decodes the
ArchAngel stream that the sibling `archangel-dat` format also uses, and any failure there returns the stored
bytes unchanged.

Because the first word of a script doubles as that signature, a script whose unpacked size is below four
bytes is returned verbatim.

## Port notes and deviations

- Archive creation is out of scope.

## References

- `GARbro/ArcFormats/Seraphim/ArcSCN.cs` - `ScnOpener.TryOpen`, `ScnOpener.OpenEntry`, `ScnOpener.LzDecompress`
