# Truevision Targa image (TGA)

* Reference: `GameRes/ImageTGA.cs` (classes `TgaFormat`, `TgaMetaData` and the `Reader` beside them), GARbro
  commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.
* Local id: `gameres-tga-image`; tag `TGA`; extension `.tga`.

The reference registers no signature of its own: the head of the picture is what decides, so this port is
offered for a name that ends in `tga` and then tells the picture by the shape of its head.

## Head

Eighteen bytes stand in front of the places of the picture.

| at | what stands there |
| --- | --- |
| 0 | the length of the name of the picture, which is passed over |
| 1 | 0 for a picture of its own colours, 1 for one that stands of a colour map, and nothing else |
| 2 | the way the picture stands of |
| 3 | the first colour of the colour map |
| 5 | how many colours the colour map holds |
| 7 | the places of a colour of the colour map |
| 8, 10 | where the picture stands to the left and above |
| 0xc, 0xe | the places of the picture, two bytes each |
| 0x10 | the places of a place of the picture: 8, 15, 16, 24 or 32 |
| 0x11 | the way the places of the picture stand |

The low four bits of the last byte name how many bits of a place hold its alpha, and the `0x20` bit means the
rows of the picture stand top down already.

The way of the picture is one of:

| way | what it means |
| --- | --- |
| 1 | the places as they stand, out of a colour map of 24 or 32 bit colours |
| 2 | the places as they stand, of their own colours |
| 3 | the places as they stand, in greys |
| 9, 32, 33 | the places of a colour map standing of Huffman, delta and runlength coding |
| 10 | the places as runs of the bits, of their own colours |
| 11 | the places as runs of the bits, in greys |

The reference's metadata reader takes all of them, and its reader then refuses the ways standing of Huffman,
delta and runlength coding. This port keeps that: such a picture is listed and then turned away as a feature
this project does not read.

## How the places stand

The depth and the descriptor name together of which places the picture stands:

| depth | the places of the picture |
| --- | --- |
| 8 with a colour map | one byte to a place, an index into the colour map |
| 8 without one | one byte to a place, a grey |
| 15, 16 | two bytes to a place, five bits to a colour, the blue lowest |
| 24 | three bytes to a place, blue, green and red |
| 24 whose descriptor names eight alpha bits | four bytes to a place, the reference reading them as such |
| 32 | four bytes to a place, blue, green, red and alpha |

A picture whose rows stand bottom up - the usual case, which the descriptor does not name away - is turned
about before it is handed over. The places of a picture standing as runs of the bits are packets of the file:
the highest bit of a packet means the place behind it is handed over as many times as the six lower bits say,
and a packet without it carries as many places as those bits say, one after another. A packet whose places
stand short of the file ends the runs, and the places behind them stand of nothing, as the reference leaves
them.

The colour map stands behind the name of the picture, at `0x12` plus the length of the name, and its places
stand behind it.

## Deviations

* Every read is bounded and a picture standing short of the places its head names is turned away, where the
  reference throws out of its own reader.
* A picture of no places at all, a colour map of no colours, and a colour map naming more colours than a
  picture of eight bits holds places, are turned away where the reference walks them.
* The colour map is handed over as a palette of a bitmap, which stands of four bytes to a colour; the fourth
  place of a colour stands empty because the reference makes a colour of the first three alone.
* The picture is handed over as a bitmap of the places it stands of (`writeBmp8`, `writeBmp8Palette`,
  `writeBmp16` with the places of five bits to a colour, `writeBmp24` and `writeBmp32`).

## Verification

Nine tests over synthetic fixtures (`tests/formats/gameres-tga-image.test.ts`): the head of a picture and the
ones it turns away; a picture whose rows stand bottom up, and one whose rows stand the right way up already;
the places of a picture standing as runs of the bits; the colour map of a picture of eight bits, with the name
of the picture passed over and the colour map that names too many colours; a picture of nothing but greys; a
picture of sixteen bits with the places of five bits to a colour; the picture whose descriptor names eight
alpha bits, which stands of four bytes to a place; and the ways standing of Huffman, delta and runlength
coding, which the reference takes and then refuses.

The behaviour of a run whose places stand short of the file, and of a colour map of a depth the reference does
not know, stand in the port as they stand in the reference but no fixture of them was finished; they stand
among the places still to be verified of the record of this format, together with the differential against
the reference on real files.
