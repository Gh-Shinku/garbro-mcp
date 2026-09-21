# ISM engine image

Reference: `ArcFormats/Ism/ImageISG.cs`, classes `IsgFormat` (tag `ISG`) and the `Reader` behind it. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License. Implemented as `ism-isg-image`
(`packages/formats/src/ism/isg-image.ts`).

## The head

The picture opens with the words `ISM IMAGEFILE` and a nothing behind them, and a head of thirty-six bytes:
the way it is packed, the size it takes packed and unpacked, its width and height, and the number of colours
its palette holds - where nothing means the whole two hundred and fifty-six. A picture of this engine is
always **one byte a pixel** through a palette of its own, and the run of its bytes begins at 0x30.

## The three ways a picture is packed

* **the packed way** (0x21) reads back from a frame of two thousand and forty-eight bytes whose cursor begins
  near its end, at 2039. Its control word is read from its **high** bit down, where a set bit stands for a
  pair of bytes - the place the run comes from, of eleven bits, and its length in the five bits above them,
  counted from three - and a clear one for a byte that stands as it is;
* **the simple way** (0x10) reads its control word from its **low** bit up, eight decisions to a byte. A set
  bit stands for two bytes: one that stands as it is, and a length behind it, which fills `2 + length` places
  with that byte. A clear bit stands for one byte on its own;
* **the overlay way** (0x34) is **not** ported: it stands over a *baseline picture read from a file the
  overlay names beside it*, which this project does not look for. A picture of that way is refused by name
  when the file is read, so it never lists an entry whose bytes cannot be handed over.

Together with the run, the picture keeps a **palette of three bytes a colour** in front of it, at 0x30.

## Deviations from the reference

* The overlay way, and the baseline pictures it needs, are refused rather than read, as above.
* The reference hands the picture over **flipped**; this port keeps the same bottom-up order by writing its
  rows from the bottom.
* Every read is bounded to the file and to the size the head names, a picture of no size is refused, and a
  run that outlives the bytes the head counts is stopped rather than read past. The reference reads through
  the end of its own view in places.
* The palette this port writes carries four bytes an entry, the last of them filled, since that is what the
  writers of this project take.

## Verification

Eight tests. Two of them are the walks themselves, on streams written out by hand: the packed way is given
four bytes that stand as they are and a copy that reads them back from the frame's own first place, with both
halves of the copy's encoding - the eleven bit place and the length above it - proved by what comes back; and
the simple way is given two decisions, each filling two places with its own byte. The rest cover the head of
both ways (including the number of colours, and the whole palette when the head names none), a picture of each
way extracted through its own palette with its bottom-up rows checked, the overlay way refused, the refusals
of a wrong word and a head that stops short, and the word of the picture itself.

What stands on the reference alone: the overlay way is never read here, no real picture is on hand to compare
against GARbro's output, and the frame's own wrap around its end is only reached by a hand built stream.
