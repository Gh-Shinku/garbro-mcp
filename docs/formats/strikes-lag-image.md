# Strikes image

Reference: `ArcFormats/Strikes/ImageLAG.cs`, class `LagFormat` with the `LagReader` beside it. The LZSS the
scanlines of a picture are packed with stands in `ArcFormats/Strikes/ArcPCK.cs` as `PckOpener.LzssUnpack` - the
walk of the archive of the same engine, which is ported beside this picture as `strikes-pck` - and it is
transcribed here as well, since the reference reaches for it from both. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as
`strikes-lag-image` (`packages/formats/src/strikes/lag-image.ts`).

## The head

The picture opens with four bytes of its own, and its head stands the other way round - every word of it is
read most significant byte first: the width, the height, the size of a scanline, where the last chunk of the
picture ends and how many chunks stand in front of it. The flags at 0x0A name the depth in their lowest five
bits with a palette above them at 0x80 and an alpha channel at 0x20. The reference **detects** three depths -
eight, sixteen and twenty four bits - and draws only the last of them, so this port keeps the detection and
refuses the other two by name.

## The chunks

The picture stands in chunks behind its colour map, and a chunk names its length most significant byte first:
a length whose highest bit is set is a stream of its own, and the rest of the word is the length the reference
reaches by clearing that bit. A stream of a picture is cut into pieces of sixty four kilobytes, the last chunk
of a picture is held to the size the head names for it, and a colour map, when the picture carries one, stands
at 0x20 and pushes everything behind it along.

## The scanlines

Every row of the picture names its own length and how it is packed. That length stands in three bytes, most
significant first, and counts whole units of **two hundred and fifty six** bytes - which the reference reaches
by stepping the value up by a byte - while a length larger than twice the size of a scanline ends the walk.
The three ways of packing stand one behind the other, and every one of them unpacks into the place the one
before it left:

* **a frame of its own**, four kilobytes whose writing place starts near its end: a control byte names eight
  decisions from its **lowest** bit up, a set bit a byte of its own and a clear one a copy out of the frame,
  whose place and length share two bytes with the length counted from three and the place out of the top four
  bits of the second;
* **a run of its own**: a byte names the way in its top two bits and the count, smaller by one, in the rest -
  four values of two bits to a byte, two of four, values of six bits spread across the bytes, or the bytes
  themselves - and every way but the last carries the sign of a value into the places above it;
* **the sum of its own bytes**, which is read back as the difference every byte stands for.

The planes of a row stand one behind the other inside it: its red at the front, then its green, its blue and,
when the picture carries one, its alpha, each of them a stride of the **width** apart. The pixel is written
blue, green, red and alpha, which is the order a bitmap keeps.

## Deviations from the reference

* Every read is bounded by the file and by the picture; the reference reads past both.
* A picture of eight or sixteen bits is refused by name, where the reference throws while drawing it.

## Verification

Eight tests over synthetic fixtures (`tests/formats/strikes-lag-image.test.ts`): the head read the other way
round with the depth the reference detects and does not draw; the planes of a row drawn into the order a bitmap
keeps; the differences of a row added back together; the frame of a packed row with a copy that reads the byte
it has just written; the four ways of a run, every one of them worked out by hand; a picture whose rows stand
in a stream of their own - which caught a length read the wrong way round, since a word with its highest bit
set is a stream and its length is the rest of the word; the alpha plane in the fourth byte; and a word the
format does not know.
