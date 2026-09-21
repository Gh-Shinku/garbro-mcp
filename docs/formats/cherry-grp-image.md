# Cherry GRP image

Reference: `ArcFormats/Cherry/ImageGRP.cs`, classes `GrpFormat` (tag `GRP/CHERRY`), `Grp3Format` (tag
`GRP/CHERRY3`) and `GrpEncFormat` (tag `GRP/ENC`), which share the `GrpReader` behind them, together with the
`Pak2Opener.Decrypt` of `ArcFormats/Cherry/ArcCherry.cs` that the encrypted one is keyed with. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `cherry-grp-image`, `cherry-grp3-image` and
`cherry-grp-enc-image` (`packages/formats/src/cherry/grp-image.ts`); the pair swap itself is shared with the
engine's archive reader, which the project already ports (`cherry/pak.ts`).

## Three heads, one reader

None of the three writes a word of its own, so the reference tells them apart by the head alone, and only
takes a file whose name ends in `.grp`:

* the first writes a head of `0x18` bytes with the width, the height, the depth, the two lengths of the
  picture and a value the reader consults. It takes twenty four bits and eight bits;
* the second writes a longer head of `0x28` bytes whose ninth byte is nothing but ones, with the two lengths
  in front of it and the alpha flag behind. It is the only one that carries thirty two bits, and it is the
  only one whose picture is not turned over - which the reader learns from the value it keeps where the
  first kind would have written an offset;
* the third writes the first kind's head keyed word by word with three constants, and can be told before it
  is keyed at all by two of its bytes. The word the reader consults for its hint is **not** among the keyed
  ones, so that value is read from the file exactly as it stands.

## How the picture is read

Which of the three ways is taken depends on the head and on the file's length, and the reference tries them
in this order:

1. if the value is `0x0f0f0f0f` and the lengths say the picture's bytes run to the very end of the file, the
   picture is read as it stands when nothing is packed, or through the unfolding way when something is;
2. if the value is the one an eight bit picture with a palette in front of it writes, or the one a twenty
   four bit picture writes, the picture's bytes are first keyed with their own place in the stream, then
   unfolded, and the rows of the unfolded picture are read into the **last row first** - so the picture comes
   out the right way up even though the file keeps it turned over;
3. a head that came out of the encrypted kind is keyed behind the head with the engine's pair swap and then
   unfolded, with its rows turned over;
4. anything else unfolds straight out of the file, with its rows turned over unless the head kept the mark
   the later kind writes.

A picture of eight bits carries its colours at the front of whatever the picture comes out of: in front of
the keyed bytes when the bytes are keyed, and in front of the pixels inside the unfolded stream otherwise.
They are four bytes an entry, blue first, which is the order a bitmap keeps.

## Deviations from the reference

* Every read is bounded. A picture shorter than the size its head names, and an unfold that does not produce
  the bytes the reader asks for, are refused here where the reference would quietly keep zeros for the
  missing bytes.
* The reference lets its own buffer run past the end of the picture when an unfold is short; this port
  refuses the picture instead.
* A picture of thirty two bits whose head carries no alpha flag is written as a thirty two bit bitmap, which
  is what the reference's own `Bgr32` format means.

## Verification

Nine tests build files with a mirror writer: a picture of the first kind whose bytes are keyed and unfolded,
and whose rows come back the right way up; a picture of eight bits read through the colours in front of its
bytes, checked both in the decoded colours and in the bitmap's palette; a picture whose bytes run to the end
of the file as it stands, whose bitmap is turned over; a picture of the later kind, which is not turned over;
the same body behind the first kind's head, which is turned over - so the two differ only by their head; the
encrypted kind, whose head and bytes are keyed, with a check that the fixture's own keying turns back into
the stream the engine would key; a picture of thirty two bits with an alpha channel; the name every kind
insists on; and the refusals - another depth, no width, a negative length, a later picture whose mark is
gone, and heads that stop short.

What stands on the reference alone: no fixture here carries colours inside an unfolded stream of the later
kind, so that path stands on the reference; the second way with a packed length that sends it on to the
unfolding one is not covered either; and no real picture is on hand to compare against GARbro's output.
