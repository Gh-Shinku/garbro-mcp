# SLG system image (`ALB`)

Reference: GARbro `ArcFormats/Slg/ImageALB.cs`, class `AlbFormat` with the `AlbStream` it unwraps through
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License). Implemented as
`packages/formats/src/slg/alb-image.ts`, registered as `slg-alb-image`.

## What the file is

The file opens with `ALB1` and the size its stream unfolds to, and what unfolds out of the front of it is a
**picture of one of three kinds**: a PNG, a DDS or a JPEG. The reference hands that picture to whichever
format reads it and lets it report the metadata; the three kinds are what tells them apart.

This port unwraps the same stream and hands a **bitmap** over, as the reference does: the picture is read with
the three readers of this project — `packages/formats/src/shared/png-image.ts`,
`packages/formats/src/shared/jpeg-image.ts` and the Direct Draw surface reader of
`packages/formats/src/directdraw/dds-image.ts` — and the header fields of all three are read off the unwrapped
picture so the listing can report them where the header lies within the head it unwraps. The JPEG reader
follows the baseline sequential profile of ITU-T T.81; the reference hands that kind to `Jpeg.Read`, the
platform decoder of the Windows imaging stack, so the two differ by a few places at the edge of a colour change
where the platform widens a twice-as-coarse chroma inside its colour conversion.

## The dictionary walk

The stream is a run of blocks, and a block opens with the word `PH`, the size of its dictionary -- which the
reference reads and **never uses** -- the number of bytes its symbols take, a byte saying whether the
dictionary is run length coded, and the marker that coding uses. The dictionary is two hundred and fifty six
entries of two bytes each:

* with the coding, a byte equal to the marker introduces a run of entries that **stand for their own index**,
  and every other byte is the first half of an entry with its second byte behind it;
* without it, the entries are read as they stand.

An entry whose first byte is its own index stands for itself; every other entry stands for its two bytes, the
**first of the pair first**. The symbols behind the dictionary are read until the count in the block's head
runs out, and every symbol that does not stand for itself is expanded the same way -- the reference does it by
pushing the pair on a stack of two hundred and fifty six bytes, so a dictionary that expands into itself
grows the stack until it overflows.

## Deviations from the reference

* A dictionary that is cut short, one whose runs would carry it past its own two hundred and fifty six
  entries, and one that nests deeper than the stack it is expanded on are all refused with `INVALID_ARCHIVE`,
  where the reference lets its own array accesses throw.
* A stream that unfolds to fewer bytes than the header declares is refused when the picture is extracted; the
  reference would leave its reader short and let it complain. The listing still reports the size the header
  declares, which is the size the entry carries.
* A picture larger than 256 MiB, and one whose unwrapped head is not one of the three kinds, are refused.

## Verification

Ten fixtures in `tests/formats/slg-alb-image.test.ts` cover a dictionary whose entries stand for their own
bytes, one whose entries stand for others and nest inside each other (the walk comes out depth first), one
that is run length coded, a stream of several blocks one behind the other, each of the three kinds of picture
decoded into a bitmap (a graphic written here place by place, a Direct Draw surface of the places the test
names, and a grey stream exactly as the Python imaging library decodes it), the header fields read off the
unwrapped picture, the listing and its metadata, and the files and streams that are turned away.
