# C4 GD image

Reference: `ArcFormats/C4/ImageGD.cs`, classes `GdFormat` (tag `GD/C4`) and `XexGdFormat` (tag `GD/XEX`),
which share the `GdReader` behind them. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`.
Implemented as `c4-gd-image` and `c4-xex-gd-image` (`packages/formats/src/c4/gd-image.ts`).

## Two engines, one reader

Two of the engine's readers write the same kind of picture, and only the head in front of it differs:

* the first writes the word `GD2` or `GD3`, which names the size of the picture (640 by 480, or 800 by 600),
  and ends with a byte of its own. The byte that says how the picture is stored stands behind a fixed number
  of pixels of one column, worked out as `4 + 3 * (width / 10) * (height / 10 - 1)` with whole number
  division - so 9024 bytes in for the smaller size, 14160 for the larger;
* the second writes no word at all. Its first byte is the way the picture is stored and its second is a byte
  of the engine's mark, and the reference only takes such a file when its name ends in `.GD`. It never
  stores a picture as it stands, only the two packed ways, and its pictures are always the smaller size.

Everything else - the depth, the rows, the three ways of unpacking - is shared.

## The three ways

The byte behind the head names how the picture is kept:

* `b` keeps it as it stands, one whole picture of blue, green and red bytes;
* `l` packs its bytes away. A bit stream reads one bit at a time: a set bit is a byte of the picture, which
  is also kept in a frame of sixty four thousand bytes; a clear bit is an offset of sixteen bits and a run of
  four bits, which stands for three to eighteen bytes copied out of that frame, each of them kept as well.
  The frame's first byte is stepped over, so the first byte of the picture lands at index one and the frame's
  own first byte stays zero;
* `p` packs its colours together. The picture begins as one solid colour, and runs of pixels are written
  over it: a run begins with two bits naming how many places to step over, with a longer form behind the
  second and a much longer one behind the third. The pixel that follows is written whole, and then a walk of
  two bit steps may carry that same colour to neighbouring rows, by a place above or below the column it was
  written in. Every place the runs left untouched keeps the fill colour, and a pass at the very end gives
  each of those places the colour of the pixel before it - so the picture always comes out whole.

## Deviations from the reference

* The reference reads the byte that names the way and then sets its own offset to that byte's place **plus
  two**, which steps over one more byte than the byte it just read. That byte is part of the head here as
  well, and the port keeps the same offset.
* Every read is bounded. Where the reference would run off the end of its own picture - a run in the `l` way
  that reaches past the last byte, or a copy in the `p` way that leaves it - this port refuses the picture
  instead. A picture kept as it stands that is shorter than its declared size is refused as well, where the
  reference would quietly keep zeros for the missing bytes.
* The head is only taken when its word ends with the byte the reference's signature carries, so the word
  `GD2` alone is not enough. The reference leaves that to its format table, which amounts to the same.
* The `p` way's walk of two bit steps ends where the reference's does; the reference treats an unreadable
  control as the end of the stream, which is the same thing this port does when the reader hands back `-1`.

## Verification

Seven tests build files with a mirror writer: a picture kept as it stands, whose rows come back with the last
one first and which a bitmap turns over (the marker in the file's first row lands at the start of the
bitmap's last row); the larger word with its own column count; a picture packed away whose literal bytes and
back reference are read back out of the frame; a picture that packs its colours together with no runs at
all, which the pass behind them turns into one solid dark colour; a packed colour carried one row down,
where a port that dropped that walk would leave the place at the fill colour; the engine that writes no
word, which is only taken from a name ending in `.GD` and never with a stored picture; and the refusals -
another digit, another way, another mark, and a picture shorter than its size.

What stands on the reference alone: no fixture here uses the long skip form of the `p` way or a copy step
other than one row down, so those stand on the reference's own arithmetic; the larger size is checked through
its head only, not by unpacking an 800 by 600 picture; and no real picture is on hand to compare against
GARbro's output.
