# Discovery resource archive (DAT/DISCOVERY)

## Reference and attribution

- GARbro reference: `Legacy/Discovery/ArcDAT.cs`, classes `DatOpener`, `BDataEntry`, `EDataEntry`
- GARbro tag: `DAT/DISCOVERY`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Detection

The format has no signature. The file has to be named `*.dat` and its name has to start with `BData`,
`EData` or `VData`, which selects the record size: 0x3c, 0x2c or 0x20 bytes per entry. The last four bytes
of the file are the little endian entry count, which has to be sane, and the index of `count` records sits
directly before it. An index that reaches the start of the file is declined.

## Index

BData and EData records are stored shuffled and are unscrambled record by record before they are read:

1. a bit permutation of every little endian word, driven by seed 13,
2. a byte permutation over the whole index, driven by seed 7,
3. a final exclusive or with 0xD6.

VData records are only masked with 0xDE and are not scrambled.

Record fields, at the given offsets:

| Offset | BData | EData | VData |
| --- | --- | --- | --- |
| 0x00 | name length | name length | name length |
| 0x04 | stored size | body size | - |
| 0x08 | unpacked size | body unpacked size | size |
| 0x0c | offset | body offset | offset |
| 0x10 | width | header size | name |
| 0x14 | height | header unpacked size | - |
| 0x18 | name | offset | - |

The name is cp932, has to be non empty and has to fit in the record. Every entry has to fit in the file. A
BData entry is marked packed when its stored and unpacked sizes differ. An EData entry stores its size as
the sum of the header and body sizes and its unpacked size as the sum of both unpacked sizes.

## Extraction

BData and VData entries are extracted verbatim; the BData image decoder is out of scope. An EData entry
holds an LZSS compressed header and an LZSS compressed body at separate offsets: the header is decoded to
its declared unpacked length with a bounded LZSS stream, and the body is decoded to the end of its stored
range. The header bytes are placed before the body.

## Port notes and deviations

- Archive creation is out of scope.
- The BData image decoder (`BDataDecoder`), including its palette and mask handling, is not ported.
- Because the body decodes to its own end, the extracted size of an EData entry is reported as unknown.

## References

- `GARbro/Legacy/Discovery/ArcDAT.cs` - `DatOpener.TryOpen`, `DatOpener.ReadBDataIndex`,
  `DatOpener.ReadEDataIndex`, `DatOpener.ReadVDataIndex`, `DatOpener.OpenEntry`, `DatOpener.Decrypt`,
  `DatOpener.Descramble32`, `DatOpener.Descramble8`
