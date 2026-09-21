# Eushully AGF image

Reference: `ArcFormats/Eushully/ImageAGF.cs`, classes `AgfFormat` (tag `AGF`) and its `AgfReader`, which
unfolds its sections through `ArcFormats/LzssStream.cs`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `eushully-agf-image`
(`packages/formats/src/eushully/agf-image.ts`).

## What the file holds

A picture of up to thirty two bits, stored with a head that is itself packed, and with its rows kept from
the bottom up. The file opens with the word `ACGF`, or with four zero bytes, which is why the reference
registers `0` beside its own word: an engine that writes nothing there is taken as well.

## The sections

Every section of this format declares two sizes: how long it is stored, and how long it unfolds to. When
the two are equal the section is kept as it stands; when they differ it is a GARbro LZSS stream, which is
the same stream the project's `inflateLzss` codec already reads, with the same settings.

The head behind the word names a kind of picture (one for twenty four bits, two for one that may carry
alpha), the size the first section unfolds to, and the size it is stored in. That first section unfolds to
a head of its own, which holds the width, the height, the depth the picture was stored in, and - when that
depth is eight bits or fewer - a palette of `0x100` colours in blue, green, red order, four bytes each. The
palette stands `0x18` bytes behind that head.

The picture stands behind three words of its own, which tell how long it unfolds to and how long it is
stored. A thirty two bit picture may then carry an alpha channel: a section marked `ACIF` that unfolds to
exactly one byte for every pixel. When that section is missing, is marked with another word, or unfolds to
another size, the picture is read as twenty four bits instead, which is how the reference falls back.

## The rows

The picture is stored with its **last row first**, so the rows are turned over as the picture is written.
The alpha channel is not: it stands in the order the picture is finally seen in, which is why the reference
counts its position by the row it is writing rather than the row it is reading.

Three ways of walking a row are chosen by the depth the picture was stored in, which is quite separate from
the depth it is written in (twenty four bits, or thirty two when it carries alpha):

* a picture stored in eight bits or fewer names every colour through the palette it carries, in four bit
  pixels packed two to a byte with the **higher nibble first**;
* any other depth is copied pixel by pixel, taking a byte for alpha from the alpha channel when there is
  one. The byte the picture itself stores behind its colours is therefore dropped.

Each row is padded to a whole number of four bytes before the next one begins.

## Deviations from the reference

* Every read is bounded here, and a section that lies outside the file or unfolds to another length than it
  declares is refused instead of throwing an end of stream error.
* The reference works the picture's own offset out as `0x18 + packed_size`, which lands **four bytes before
  the first section ends**. The two sections therefore share four bytes, and the word the picture's reader
  steps over is written exactly there. A test that builds a file faithfully has to keep the same overlap,
  which is why its own fixtures leave the last four bytes of the packed head unused.
* A picture with no width, no height or no stored depth is refused, as are kinds of picture the reference
  does not name.

## Verification

Eight tests build files with a mirror writer: a stored twenty four bit picture whose rows are turned over, a
picture whose word is empty, an eight bit picture read through its palette, a four bit picture read with the
higher nibble first, a thirty two bit picture whose alpha channel is the one that counts (the byte the
picture stores itself is deliberately different, so a port that kept it would fail), the fall back to twenty
four bits when that channel is missing, and a picture whose head and body are both packed. One test refuses
a kind of picture, a word of another engine, a stored depth of nothing, no width, and a file that stops
inside its own head.

What stands on the reference alone: no fixture here uses a packed section that carries a back reference, so
only the codec's own tests pin that path down (the LZSS stream this format uses is the project's shared
codec, whose settings match the reference's `LzssReader`); and no real picture is on hand, so the depths the
engine actually writes, and any field this port reads that no fixture fills, remain to be checked against
GARbro's own output.
