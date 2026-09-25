# GPlay engine resource archive (YSK)

* Reference: `Legacy/GPlay/ArcYSK.cs` (classes `YskOpener` and the `DesTransform` beside it), GARbro commit
  `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.
* Local id: `gplay-ysk-archive`; tag `YSK`; extension `.ysk`.

## Head and index

The archive opens with the letters `AA` and ten places of the file of the digits of the version of it, then
the count of the entries of it as a word of four places of the file. The index stands at 0x10: a name of
0x14 places of the file to an entry (of the places of the file of the engine, of the places of the file of a
name of the engine of the places of the file of the archive), then the places of the file of the entry. The
places of the file of the entries stand behind the index, one behind the other, in the order of the index.

## What this port does not carry

* **The places of the file of the cipher of the engine** (`DesTransform`). The reference stands of a walk of
  the places of the file of the cipher of the engine itself for the places of the file of the text of it (of
  every entry of `.TXT` and `.DAT` of no mark `#` or `*` at the front of it), for the eight first places of
  the file of every block of 0x1000 places of them of every entry of `.JPG`, and for the places of the file
  of every 0xA0 places of the file of the BMP of the engine behind the places 0x493AA of it. This port
  stands of a walk of the places of the file of the cipher of the engine itself, of the key of the engine
  (`0x1234567812345678`, of the places of the file of the walk of the engine) **which stands of no
  verification yet**: the places of the file of the walk of the key schedule of it (the sixteen places of the
  file of the walk of the engine, of the places of the file of the key of it) stand of the places of the file
  of an independent walk of the same reference written apart from this port, and the walk of the places of a
  block of the places of the file of it stands of different places of the file from the walk of that
  reference (the places of the file of the block `0x1122334455667788` stand of `0x3FA4D9DC3C863E03` of this
  port and of `0xD09828A88801A6BA` of the walk of the places of the file written apart from it).
  The entries of the archive that stand of the cipher, and the places of the file of the BMP of the engine
  behind the places 0x493AA of it, stand of `UNSUPPORTED_FEATURE` here.
* **The places of the file of an entry standing beyond the places of the file of the archive of it, a count
  of the entries of the archive standing of no places of it, and a name of the head of the archive of no
  places of the file of the digits of the engine.** Each of them stands of `INVALID_ARCHIVE` here, as the
  reference stands of `null` and of its own guards.

## What this port carries

* The index of the archive, of the names of the entries of it (of the places of the file of the engine
  itself, of the places of the file of the digits of the version of it), the places of the file of the
  entries of it and the places of the file of the entry of an entry standing beyond the places of the file of
  the archive.
* The places of the file of an entry of the archive that stands of no walk of the cipher of the engine (of
  the places of the file of an entry of no `.TXT`, `.DAT`, `.JPG` or `.BMP` behind it, and of the places of
  the file of the text of the engine of a mark `#` or `*` at the front of it).
* The places of the file of the kind of the places of a colour of a place of the picture of the BMP of the
  engine: the walk of the reference stands of the places of the file of the BMP of the engine itself, of the
  places of the file of the walk of the places of a colour of a place of the picture of its own.

## How the walk stands verified

Two walks of our own stand of the archive of the engine: the index of it (of the names of the entries of it,
of the places of the file of the entries of it, of the places of the file of the digits of the version of it,
of a count of the entries of it standing of no places of the file of the archive, of the places of the file
of an entry of it standing beyond the places of the file of the archive), and the places of the file of the
head of the archive of it (of the marks of the head of the archive of the engine, of the entry of an entry of
it of no walk of the cipher of the engine).
