# Giga engine resource archive (`giga-all-archive`)

Reference: `Legacy/Giga/ArcALL.cs`, class `AllOpener`, tag `ALL/GIGA`, GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## What the format is

An archive of this engine carries **no index at all**, and the reference holds none in a resource file either:
`AllOpener.FileMap273` is a table written out in the source, keyed by the name of the archive, that names
every file of it with the place of the file, the count of the places it unpacks to, the count of the places
it stands of and whether it stands packed. It holds five archives over 1948 files:

| archive | files |
| --- | --- |
| `ALLCHP.273` | 199 |
| `ALLGRP.273` | 339 |
| `ALLXXX.273` | 366 |
| `ALLMAP.273` | 784 |
| `ALLMCP.273` | 260 |

The reference recognises one of them by the **name of the file alone** (`FileMap273.TryGetValue
(base_name)`), and a file whose name stands in no table of it stands of no archive at all.

The places of a file then stand of `AllOpener.LzssUnpack`: the count of the counts of the walk of them at the
head of the file (four places). A count of nought stands of the places of the file **as they stand**, the
count of the places of the file being the count of the places the table names. Every other count stands of
the counts of the walk of the engine, eight to a control place of the file, and of two shapes:

* a count of the walk of the engine whose place stands at one stands of a place of the file itself, one place
  of the file behind the control place;
* every other stands of two places of the file: the counts of the places of the file of the walk of the
  engine, of one place of the file itself where the counts of the places of the walk of the engine of the
  first four places of the count stand at nought and of the counts of the places of the file behind them
  otherwise, and of a count of the places of the file of `count + 2` where the counts of the places of the
  walk of the engine stand of counts of their own and of `count + 0x12` otherwise.

The places of a count are copied **overlapping** (`Binary.CopyOverlapped`), so a count may name places of the
file that it writes itself.

## The port

`packages/formats/src/giga/all-archive.ts`: the table of the reference read off the source itself (a
generated table of 1948 entries, which is what the reference's own 2090 line file nearly all is), the listing
and the walk above. The format stands of the extension `273` of the reference and stands last among the
formats of the engine (`priority: -1`), the name of the file being the whole of its detection.

## Deviations from the reference

* The walk of the places of a file stands of the bounds of the file of this project where the reference reads
  past them (a control place or a count of the places of a file that stands past the end stands of no file at
  all here, and of the counts of the engine of its own there).
* The reference reads the places of a file of the count of the places of the table even where those places of
  the file do not stand within the archive; this port refuses such an archive with the whole of it
  (`checkPlacement`), which is the rule this project follows everywhere else.
* The place of a count of the places of the walk of the engine stands of the counts of the places of the file
  in front of it here, and of no sign of its own (`offset < 0` stands refused, where the reference would read
  the places of the file before the file itself).

## Verification

`tests/formats/giga-all-archive.test.ts` (3 tests):

* the table: its five archives, the count of the files of every one of them, and the first three files of
  `ALLCHP.273` pinned against the reference's own text (`ankei_a.chp`, `0xC436` places of the walk of the
  engine from `0x13C5`); the lookup by name, of either case, and a name of no table at all;
* the walk of the places of a file: a count of the walk of the engine of nought (the places of the file as
  they stand), a walk of eight counts of the places of the file (one control place of the file, eight places
  of the file itself), and a count of the places of the file that stands of the counts of the places behind
  it, worked out **by hand** (`0x2007` stands of four places of the file seven places in front of the place
  of the file itself);
* an archive of an engine of 366 files, of a name of the table (the listing and the refusal of the places of
  a file that stand of counts past the places of the file), and a file of another name refused.
