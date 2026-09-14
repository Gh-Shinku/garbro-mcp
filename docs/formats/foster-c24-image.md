# Foster game engine image (C24)

Reference: `GARbro/ArcFormats/Foster/ImageC24.cs`, classes `C24Format` and `C24Decoder` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/foster/c24-image.ts` (`fosterC24ImageDescriptor`, `fosterC24ImageFormat`, id
`foster-c24-image`), with `readC24ImageLayout`, `readC24RowOffsets` and `unpackC24Rows` shared with the C25 image
for which this one is the predecessor.

An image of the Foster engine, whose rows are stored run length packed and in an order of their own. Twelve bytes
hold the word `C24` and the offset of the frame; the **count** beside them is the archive's frame count, which
the reference asks to be above nothing and then never looks at again. The frame itself holds the width, the
height, a pair of offsets and the table of rows: one word a row, each naming where that row begins.

## A row

Behind the table, each row is a series of runs that **alternate** between two kinds: every row starts with a
**fill** and then every run after it is the other kind:

* a **fill** writes three bytes of `0xFF` a pixel, so a fill is a run of white;
* a **copy** takes three bytes a pixel from the file as they stand, and a run whose bytes are not there keeps
  nothing at all — the reference's own reads are not checked.

A run is one pixel count in a byte, and the two kinds have a mark of their own for a longer one: a count of
`0xFF` in a **fill** and a count of `0` in a **copy** mean that the real count is the word behind them. The mark
is only looked for in the kind of run it belongs to, so a copy of exactly `0xFF` pixels is written as it stands.

The cursor the runs are written with runs on **across** rows: the reference counts the pixels of a row and starts
the next row where it stopped, and a row whose runs add up to more than the width goes on writing behind it. Since
every row adds up to at least the width, a row that goes past its own end always passes the end of the whole
image as well, which the reference's own framework refuses — the port raises an invalid archive error there.

The tests cover the word with a frame the reference would refuse and a frame that would stand past the end of the
file, a row of two fills and two copies with the two offsets it reports, both marks of a longer count, a copy of
two hundred and fifty five pixels that is not mistaken for a mark, two rows read by the offsets of their table,
and a run that would write past the image, a row whose offset is past the end of the file, a marked count with no
word behind it and a row that runs into the end of the file.
