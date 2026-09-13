# Cyberworks/TinkerBell resource archives (ARC/Cyberworks, ARC/Csystem, ARC/Csystem/2)

## Reference and attribution

- GARBro reference: `ArcFormats/Cyberworks/ArcDAT.cs`, classes `DatOpener`, `OldDatOpener`, `OldDatOpener2`
- GARBro tags: `ARC/Cyberworks`, `ARC/Csystem`, `ARC/Csystem/2`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

All three formats are dat archives without a signature. The archive file itself only holds payloads: the entry
table lives in a sibling file whose name is derived from the archive's own name, and every payload offset is
absolute inside the archive. The three formats differ in how that table is named, how it is stored and how its
records are laid out.

## The three formats

| Format | Extensions | Table name | Table digits | Table body |
| --- | --- | --- | --- | --- |
| `ARC/Cyberworks` | dat, 04, 05, 06, app | modern name parsers, or `Arc0?` when a meta archive is present | 8 | numeric records with two type bytes |
| `ARC/Csystem` | dat | `^Arc0(\d)\..*$` | 4 | comma separated text |
| `ARC/Csystem/2` | dat | `^Arc0(\d)\..*$` | 4 | numeric records with one type byte |

The old name mapping replaces the archive number with the table number: `Arc02.dat` and `Arc03.dat` read
`Arc00.dat`, and `Arc05.dat` reads `Arc04.dat`. Other numbers decline the archive.

### Modern table lookup

The modern format first looks for a meta archive in the same directory. `Arc06.dat` is preferred unless the
archive under inspection is that file itself. When a meta archive parses, the game title it holds selects the
tree of archives, and only the old `Arc0?` name mapping can open a table. Otherwise `Arc00.dat` is tried for a
title alone, and the archive name is matched against these patterns in order:

```
^.+0?(?<id>(?<num>\d)(?<idx>[a-z])?)(?:|\..*)$   digits 4, 5, 6 and 8 open tables 1, 2, 3 and 7
^(?<name>d[a-z]+?)(?<idx>[ah])?\.dat$            dh.dat and da.dat open dh.dat, the latter as sub-archive 1
^patch0(?<num>[2468])\.dat$                      patch0n.dat opens the table numbered n - 1
^(inyoukyou_kuon|mugen.*)\.app$                  both application archives open <name>.dat
```

A trailing letter after the first pattern's digit selects the sub-archive: `Arc06b.dat` opens table `Arc03b.dat`
as sub-archive 2.

A meta archive is a table file of at most 4096 bytes whose unpacked body opens with a 32-bit CP932 title length
and the title itself.

## Table storage

A table file opens with two decimal fields of `digits` digits each, the unpacked and the packed body length,
followed by the LZSS-packed body (see `docs/formats/cyberworks-appendix.md` for the field encoding). The modern
reader walks records of `[i32 record size][u32 identifier][u32 unpacked size][u32 stored size][u32 payload
offset][type bytes]`, where a record of at least 0x17 bytes also carries four skipped bytes and the one-byte
index of the sub-archive it belongs to. Records of other sub-archives are left out, and a payload that leaves
the archive drops its record. The old formats read the same records with exactly one type byte and reject a
table whose record size is not 0x11.

The comma separated table of `ARC/Csystem` reads one entry per line:

```
name,unpacked size,stored size,payload offset,extension
```

The name is completed with the extension, so a line `one,17,17,0,b` names its entry `one.b`. An extension of
`b` marks an image, `k` and `j` mark audio, and any other extension leaves the entry untyped. A line without
exactly five fields, a size field that is not a decimal number, or an entry that leaves the archive declines the
whole table.

## Listing and extraction

Entry names are the six-digit identifiers of the numeric tables or the names the comma separated table spells
out, completed with a one- or two-character extension when the type bytes are printable. The extension also
names the entry type in the metadata as `image` or `audio`, and an image entry marks the archive metadata with
`hasImages`. The single exception is the game named `ドキドキ母娘レッスン ～教えて♪Ｈなお勉強～`, whose bare `b`
extension does not mark images. Packed payloads are LZSS streams with GARbro's default frame settings.

## Deviations from GARbro

- Image payloads are returned as stored. GARbro runs them through a scheme-driven decoder whose key data lives
  outside the archive, so the scheme lookup is not attempted and only `hasImages` is reported.
- The comma separated table is decoded byte for byte as Latin-1. GARbro reads it with a UTF-8 stream reader that
  would replace non-ASCII name bytes, which cannot round-trip; ASCII tables are identical either way.
- GARbro reads the table and the meta archive through bounds-checking streams that decline on a short read. This
  port bounds-checks the same fields.
- A packed table or payload that decodes past its declared size is truncated, mirroring the reference, which
  reads exactly the declared size; a stream that ends early declines the archive.

## Tests

`tests/formats/cyberworks-dat.test.ts` covers all three formats with companion tables written to disk: modern
table lookup, the meta archive path including the exempt game title, sub-archive filtering, stored and packed
payloads, the comma separated table with packed and untyped entries, the old numeric table, and the rejections
of missing or malformed tables, out-of-range entries, malformed lines and a record size that disagrees with the
old layout.
