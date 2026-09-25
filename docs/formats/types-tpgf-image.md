# Types image (TPGF)

* Reference: `Legacy/Types/ImageTPGF.cs` (classes `TpgFormat`, the `TpgfReader` beside it and the `BitStreamEx`
  of the same file), GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.
* Local id: `types-tpgf-image`; tag `TPGF`; extension `.tpg`.

## Head

The picture opens with thirteen places: the word `TPGF` behind the first four of them, the places of the
picture as two words of their own written from the higher place down, and the places of a place of the
picture, which stand of eight or of twenty four of them. The places of the picture stand behind the head.

## The bits

The bits of a picture stand of the highest place of every place of the file first, and the places behind the
end of the picture stand of nothing.

The reference reads them of a place of its own, of the places a run of the colours of a picture stands of
read in one walk of its own (`BitStreamEx.ReadEncodedBits`, which reads as many places of the file as the run
names and holds them of the places of the run), behind the places of the bits it has read of the word of the
file. That walk takes the places of the run from the file itself, of the places of the word of the file the
run stands of, so the port reads the same places as a walk over the bits of the file, one place after
another, which is the same reading of the bits.

## The lines of the picture

Every line of a picture stands of runs of the bits: three places of them name one of the places of a colour
of the run (nothing of them stands of the places of the picture behind the line, and any other place of them
names as many places of the run as stand of the place), and the places behind those name how many places the
run stands of - a walk of the places of the file of the count the reference takes two off.

A picture of three colours stands of three lines of the picture to a row of it, of one place of a colour of
every line, and a picture of eight places to a place stands of one line to a row, of the greys of its own. A
picture whose places stand of the places of an alpha behind them carries a head of its own behind the places
of its colours: a place of the file standing of one, the thirteen places of the head, and then the lines of
the alpha, which stand of the places of the picture one off.

## The places of a line

Every place of a line behind the first of them stands of the place before it and of the place before that,
of a table of their own which the reference stands of as a table of 256 by 256 places:

```text
v = j < 0x80 ? j : (-1 - j) & 0xFF;
if (2 * v < i) v = i;
else if ((i & 1) != 0) v += (i + 1) >> 1;
else v -= i >> 1;
table[i, j] = j < 0x80 ? (byte)v : (byte)(-1 - v);
```

This port stands of the same table, of the places of the table standing of the reading above and not of a
table of its own; the two places of a line it was held to stand of are in the tests of the format.

## Deviations

* Every read is bounded: a picture standing short of the places it names, a picture whose count stands of
  more places than the walk of the bits holds, and a picture of no places at all, are turned away.
* A run of a line standing of more places than the line holds reads the places of its own and stands of the
  places of the line alone; the reference writes past the end of its own line.

## Verification

Six tests over synthetic fixtures (`tests/formats/types-tpgf-image.test.ts`): the head of a picture and the
ones it turns away; a picture standing of a run of the places of nothing, of the greys of the engine, and one
standing of the places of a colour of its own; the places of a line standing of the place before them, of
both the places of the table above; a picture of three colours, of the places of every colour of it; the
places of an alpha standing behind the colours of a picture; and the word the format tells a picture by.

A picture of the places of a colour standing of the word of the file itself (the walk the reference reads a
run of the places of a colour of), and a picture of more than one line to a colour, stand in the port as they
stand in the reference but no fixture of them was finished; they stand among the places still to be verified
of the record of this format, together with the differential against the reference on real files.
