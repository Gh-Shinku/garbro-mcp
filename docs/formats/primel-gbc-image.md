# Primel Adventure System image (GBC)

* Reference: `ArcFormats/Primel/ImageGBC.cs` (class `GbcFormat`, reader `GbcReader`), GARbro commit
  `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.
* Local id: `primel-gbc-image`; tag `GBC`; extension `.gbc`.

## Head

The picture opens with the word `GBCF` (the file names it `GBCF`; the reference's `Signature` is
`0x46434247`, which is that word read from the low byte up). At `0x8` stand the width and the height as
32 bit words, at `0x10` the places of a pixel (8, 24 or 32) and at `0x12` the flags. The bits of the
picture stand from `0x30`.

The flags' high byte naming `0x800` means the picture stands of the **second way**; every other word draws
it the first way. A picture of any other depth than 8, 24 or 32 is turned away.

## The two ways

Both ways draw the picture as blocks of eight places by eight, and both keep the place of a pixel as a
value below the place of the block - the first way takes 128 off every place of a block as it hands it
over, the second hands the places over as they stand.

The **first way** carries the places of the first plane of a block along the **zigzag order** of it: every
place of the block is the place before it plus a run of the bits, so the whole plane stands as the sum of
the runs that came before. The planes of the other colours stand of runs of their own, each of them
carried along the rows of the block and then along its columns (the reference's `RestoreBlock`).

The **second way** names the places of a block one by one, of as many places standing over as the bits
behind a place of nothing name (up to sixteen; sixteen of them ends the block). It then carries the places
of the block along its rows and then along its columns (the reference's `RestoreBlockV2`).

A run of the bits is a count of four bits:

| count | place |
| --- | --- |
| 0 | nothing |
| 1 | 1 |
| 2..7 | the bits behind it plus `1 << (count - 1)` |
| 8 | -1 |
| 9 | -2 |
| 10..15 | the bits behind it minus `2 << (count - 9)` |

The second way's count of nothing carries the places standing over as well: one plus the run of set bits
behind it, and sixteen of them (a run of fifteen) ends the block.

## The colour of a place

The places of a colour stand the other way round in the block from the way a bitmap keeps them. The first
way hands the three places of a colour over reversed (the last of them first), and with four places of a
pixel the whole of them stand reversed. The second way hands the first three over reversed and keeps the
fourth (the alpha place) where it is. This is the reference's own arithmetic, kept as it stands.

## Deviation

* Every read is bounded: a picture whose bits end inside a block, and a picture whose word, depth or
  places do not stand of a picture, are turned away instead of walking past the end of the file.
* The picture is handed over as a bitmap of the places of the picture (`writeBmp8` for a picture of eight
  bits, the greys of the engine, `writeBmp24`, `writeBmp32`).

## Verification

Four tests over synthetic fixtures (`tests/formats/primel-gbc-image.test.ts`): the head of a picture and
the ones it turns away; a block of one place of the first way, with and without a run of the bits naming
one place of the zigzag order; a block of the second way whose places stand of nothing; and a picture
handed over as a bitmap, told by the word it opens with.

The **second way's places standing over** - the runs that end a block and the places they carry - stand in
the port as they stand in the reference, but their fixture was not finished: the walk of the fixture and
the port do not agree on how many bits a block's places stand of, so the record of this format names them
among the places still to be verified.
