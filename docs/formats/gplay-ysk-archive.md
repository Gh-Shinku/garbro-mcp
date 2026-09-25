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

## The walk of the cipher of the engine

The places of the file of the engine stand of a walk of the places of the file of the cipher of the engine
itself (`DesTransform`), of the key `0x1234567812345678` of the places of the file of the walk of the engine:
the walk of the places of the file of the cipher stands of the places of the file of the key of it (of the
sixteen places of the file of the walk of the engine, of the places of the file of the sixteen places of the
walk of the engine of a place of the walk of a colour of a place of the picture) and of the walk of the
places of the file of the block of eight places of them at a time, of the places of the file of the walk of
it of the lowest place of a place of the file first.

The reference stands of the walk of the places of the file of the cipher of the engine for the places of the
file of the text of it (of every entry of `.TXT` and `.DAT` of no mark `#` or `*` at the front of it), for the
eight first places of the file of every block of 0x1000 places of them of every entry of `.JPG`, and for the
places of the file of every 0xA0 places of the file of the BMP of the engine behind the places 0x493AA of
it.

## What this port does not carry

* **The places of the file of an entry standing beyond the places of the file of the archive of it, a count
  of the entries of the archive standing of no places of it, and a name of the head of the archive of no
  places of the file of the digits of the engine.** Each of them stands of `INVALID_ARCHIVE` here, as the
  reference stands of `null` and of its own guards.
* **Packing an archive.** `YskOpener` stands of no walk of it in the reference.

## How the walk stands verified

Six walks of our own stand of the archive of the engine: the index of it (of the names of the entries of it,
of the places of the file of the entries of it, of the places of the file of the digits of the version of it,
of a count of the entries of it standing of no places of the file of the archive, of the places of the file
of an entry of it standing beyond the places of the file of the archive), the places of the file of the head
of the archive of it (of the marks of the head of the archive of the engine), the walk of the places of the
file of the cipher of it (of the places of the file of the walk of the key of the engine and of the places
of the file of the walk of the block of it), and the places of the file of the entries of it: the text of
the engine of a mark `#` at the front of it, the text of the engine of no mark of it, the places of the file
of an entry of no walk of the cipher of the engine, the places of the file of a picture of the engine (of the
places of the file of the block of it), and the places of the file of the BMP of the engine (of the places of
the file of the kind of the places of a colour of a place of the picture of it and of the places of the file
of the walk of the places of the BMP of it behind the places 0x493AA of it).

The walk of the places of the file of the cipher of this port stands of the places of the file of a walk of
the same reference written apart from it of the same places of the file of every picture of it: the places of
the file of the block `0x1122334455667788` stand of `0xD09828A88801A6BA` of both of them, and the places of
the file of the block of `AABBCCDD` of `F6472BD0`. The walk of the places of the file of the *tables* of the
cipher of this port caught a walk of the places of the file of the table of the walk of the engine standing
of the places of the file of the walk of the eight S tables of the engine at the *other* end of the places of
the file of the table of a colour of the picture: the places of the file of the first place of the walk of
the engine stand of the lowest of the places of the file of the table of the colour of the picture, of no
places of the file of the highest of them.

The places of the file of the walk of the engine of the keys of the game stand of the places of the file of
the walk of the engine of this port and of a walk of the same reference written apart from it: the places of
the file of the block `0x1122334455667788` of the key `0xDEADBEEFCAFEBABE` stand of `0xB7031D97614B8A6F`,
of the block `0x0123456789ABCDEF` of the same key of `0x8AEABFD2AD2DBC43`, and the two places of the file of
the key `0x0F1E2D3C4B5A6978` of `0x3C21A023CAA1A9FF` and `0x46C6B622077ED9BF`.
