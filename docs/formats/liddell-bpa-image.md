# Liddell image

Reference: `Legacy/Liddell/ImageBPA.cs`, classes `BpaFormat` (tag `BPA`) and `BpaDecoder`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License. Implemented as `liddell-bpa-image`
(`packages/formats/src/liddell/bpa-image.ts`).

## The head

A picture opens with the four bytes `-BPA` and a dash behind them, and a head of seventeen bytes: its width
at 6, its height at 8, the number of colours at 0x0A, the place of its palette at 0x0C, the place of its run
at 0x0E, and a byte at 0x10 that names the depth **in whole bytes** when the picture keeps no palette of its
own. A picture with a palette is always of one byte a pixel, and its palette is kept **red first**, of three
bytes a colour, where the writers of this project take blue first and four bytes an entry.

## The run of a channel

The run works in rows aligned to **four pixels**, and it reads a byte holding **four chunks of two bits**,
each taken from that byte's own top. A chunk stands for at most sixteen places:

```text
0  the places stand as they are, as many as the chunk holds
1  a value, then a count byte: that many places take the value
2  a control word - least significant byte first, read from its own top - and a value: a set bit of the word
   takes the value, a clear one a byte that stands as it is
3  a place for every one of the chunk's own places, read from the stack of the six values used last
```

The stack keeps the value used last at its front and never holds one twice. The place of the last kind is
read through a code of the reference's own, and **two of that code's branches can never be reached**: both
need a value the first bit cannot have, so every place of that kind takes the code's last branch, which
gathers **eight** bits into a value behind one bit the run reads first and leaves aside.

## Deviations from the reference

* A picture of more than one channel is drawn together from the channels' own rows, as the reference does - a
  channel's rows read from its last one down - and one byte stands between two channels' runs, which the
  reference reads and leaves aside as well.
* The run works in rows aligned to four pixels, and this port draws them together before writing a bitmap,
  since the writers of this project take packed rows.
* Every read is bounded to the file; a picture of no size, a palette that reaches past the file, and a depth
  that is not eight, twenty-four or thirty-two bits are refused.

## Verification

Eight tests. Two cover the head, with and without a palette of its own, and the width an index is read at.
Four cover the run's own kinds of chunk, each built by hand: places that stand as they are, a value filled
over as many places as its own count byte says, a control word that mixes one value with places that stand as
they are (whose word stands least significant byte first and is read from its top), and places of the stack's
kind, whose own code is pinned **bit by bit** - including the bit the run reads and leaves aside, and the
byte that stands behind four such places. The last one covers a picture of **three channels**, each standing
for one value of its own throughout, so every place of the picture must come out as that value in its own
channel: the drawing together of the channels, the rows each of them is read from, and the byte that stands
between two of their runs are all pinned by it - and its own control bytes were what taught this port that a
control byte stands over **one row**, not over a whole channel.

What stands on the reference alone: no real picture is on hand to compare against GARbro's output, and a
chunk that stands for more than four places at once is not reached by any fixture here.
