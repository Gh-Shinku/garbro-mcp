# Mermaid image (GP1)

Reference: `GARbro/Legacy/Mermaid/ImageGP1.cs`, class `Gp1Format` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/mermaid/gp1-image.ts` (`mermaidGp1ImageDescriptor`,
`mermaidGp1ImageFormat`, id `mermaid-gp1-image`).

An image of the Mermaid engine, from *Ayakashizoushi*. Eight bytes name the width and the height as words, and
behind them sit three channels — blue, green and red, in that order — one after another, each run length packed
on its own. The reference describes every image it reads as twenty four bits.

There is **no word to find**: the format's own signature is nothing, so its reader asks for the extension `.GP1`
and nothing else. The port has nothing in its `detection` either, which asks the registry to try it on every file,
and its own reader asks for the extension in the same place the reference does.

## A channel

A count byte asks for one of two things:

* **this many or fewer than `0x32`** — that many bytes as they stand, so fifty bytes are the longest run of them
  a count byte can ask for;
* **more than `0x32`** — the byte after the count, written that many **minus** `0x32` times, so `0x33` is one copy
  and `0x34` is two.

A count of nothing asks for nothing and the channel carries on with the next count byte.

Three details of the reference carry over. A channel that runs out of bytes before it is filled keeps whichever
zeros it was left with, because the count byte it would read next is the end of its input; the bytes of a run are
read through the framework, which writes as many as it was told to whether or not the file had them, but the
**value** a run repeats is read without a check and so a file ending there stops with an error instead. And a
count that would write past the end of a channel — either as bytes or as a repeated value — is refused: the
reference's own framework throws where the buffer would be overrun, and the port raises an invalid archive error
in the same place.

The reference reads the three channels out of the file one after another by position, so a blue channel that is
short spends bytes the green channel would have read; the port carries the position the same way. The channels
are then put back together a pixel at a time, and the image is top down, which the reference's own
`ImageData.Create` makes it.

The tests cover a file found by its name and the same bytes under another name, the measurements and the word
the port reports, the three channels put back together as one image with the row padding a twenty four bit bitmap
of two pixels takes, the longest run of bytes a count byte can ask for beside runs of one, two and three, a count
of nothing, a file that ends in the middle of a channel, the two measurements that cannot be read, and a run
whose value is missing, a run longer than its channel and more bytes than a channel has room for.
