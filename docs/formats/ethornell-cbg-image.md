# BGI/Ethornell compressed image (`CompressedBG`)

Format reference: GARbro `ArcFormats/Ethornell/ImageCBG.cs` (`CompressedBGFormat`, `CbgReader`,
`HuffmanTree`, `ParallelCbgDecoder`), GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT
License. The key walk of the entries is the `UpdateKey` of `BgiDecoderBase`
(`ArcFormats/Ethornell/ArcBGI.cs`), which this project already carries as `updateDscKey` beside the DSC
decoder.

## Head

The file starts with the fifteen letters `CompressedBG___` and a head of 0x30 bytes:

| offset | field |
| --- | --- |
| 0x10 | width (`u16`) |
| 0x12 | height (`u16`) |
| 0x14 | the places of a colour (`i32`): 8, 16, 24 or 32 |
| 0x20 | the count of the places of the walked stream (`i32`) |
| 0x24 | the key of the engine (`u32`) |
| 0x28 | the count of the places of the stored stream (`i32`) |
| 0x2C | the sum of the walked places (`u8`) |
| 0x2D | the exclusive or of the walked places (`u8`) |
| 0x2E | the version (`u16`) |

The reference refuses a depth outside the four, a sixteen bit picture of the second walk, and a version
past the second one. This port also refuses a picture of no width or height, of a negative stream count,
and of more than 0x10000000 places, which the reference would try to lay down all the same.

## The key of the stored stream

Every place of the stored stream carries the key of the engine, which the reference takes off as it reads
(`data[i] -= UpdateKey()`). The arithmetic is the `BgiDecoderBase.UpdateKey` walk: two products of 20021,
one of the low half of the key and one of the high half with a magic of nothing, whose sum feeds the next
key. The sum and the exclusive or of the walked places are then compared with the two letters of the head,
and a stream that does not stand is refused.

## The first walk

The walked stream of the head holds the weights of the leaves: 0x100 counts, seven bits to a letter with
the high bit of the last one clear. The coded places stand **behind** that stream, in the clear: the
picture of the reference is itself the bit stream its tree walk reads, and it leaves that stream standing
right behind the walked stream of the head, which the port's bit reader follows. Nothing behind the head is
keyed, so the sum and the exclusive or of the head cover the weights alone. The weights are joined two at a time, the lightest first and the lower
place winning a draw, until the joined weight reaches the sum of the weights of the leaves; the last node
of the run is the root. A place is then read a bit at a time from the root down, and the node it lands on
is the place of the walked stream. `HuffmanTree` is written twice in the reference: the second walk takes
the first valid node it meets as the first child of a join and only then looks for a lighter one, which
this port carries as the `secondWalk` flag of `buildCbgHuffmanTree`.

The walked places are then turned into the places of the picture by runs: a count, then either that many
literal places or that many places of nothing, the two kinds of run taking turns. The reference stops at
the end of the stream, at a run of literal places that would reach past the stream, and at a run that
would reach past the picture.

Every place is finally added to the mean of the place before it and the place above it, halved where both
stand, which is what `ReverseAverageSampling` does; the mean is taken for every place of a colour of the
picture on its own.

## The picture

The places are handed over as a bitmap of the depth of the head: eight places to a colour becomes a grey
picture (the bitmap writer of this port lays a grey ramp down), sixteen becomes five bits of red, six of
green and five of blue, twenty four becomes three places, and thirty two becomes four. The rows of the
reference's own pictures are not turned over, so the first row of the walked stream is the top row of the
picture.

## The second walk

Version 2 hands the picture over as blocks of eight by eight places. The table of the places of the colour
stands in the walked stream of the head (0x80 places, the first sixty four for the channel of the light and
the last sixty four for the two channels of the colour), and everything else stands **behind** that stream
in the clear:

* the weights of two trees, one of 0x10 leaves for the counts of the places and one of 0xB0 leaves for the
  places themselves, joined by the same rule as the first walk, with its own tie break;
* the places of the blocks of rows: one word a block of rows and one more for the walk of the alpha, every
  word the place of its block within the places of the blocks, so the place of a block is that word plus
  `((width + 7 >> 3) + 7) >> 3` places of padding;
* a run of blocks: a count of the places of a block, then a walk of the places of the colour of the block
  and a walk of the places it carries, in the order of `block_fill_order`, and then the places of the alpha
  for the last run of a thirty two bit picture.

A count of the places of a colour is a signed walk with a running total: the count of the letters is a
token of the first tree, the place itself is that many letters, and a place whose highest letter stands
clear counts as that many letters below nothing. The second tree then carries places of the colour of a
block on top, one run of letters to a place, with the count of its own letters in the high half of the
token and the place of the picture in the low half, 0xF stepping the walk sixteen places on and 0 ending
it.

Every channel of a block is turned by the discrete cosine transform of the reference's own table (with the
table of the head for its quantisation), and the places of a block are then read out of the three channels
as full range YCbCr: the light channel with the red, the green and the blue places, the four place of a
colour left at nothing where the walk of the alpha carried none. A picture of eight places to a colour
takes the light channel alone for all three of its places.

The reference walks the runs of blocks side by side with `Task.Run`, every run writing a region of its own,
so this port walks them one after another and lays down the same places.

## Deviations of the second walk

* The reference computes its transform in single precision. This port carries the same constants and
  rounds every step to a single, so the places it lays down stand as the reference lays them.
* The reference hands the places of the second walk over with four places to a colour and rows of whole
  blocks of eight, so a picture whose width is not a multiple of eight carries the places of the padding of
  its last block. This port takes those places out and hands a bitmap of the size of the head over.
* A block whose places reach past the places of the run of blocks is refused as `INVALID_ARCHIVE`, where
  the reference would write past its own buffer.

## Tests

`tests/formats/ethornell-cbg-image.test.ts` builds its fixtures out of the reference's own head, key walk
and weight tables: the weights of a tree of one weight each, the places of the walked stream coded by
hand, the key laid over every stored place, and the sum and the exclusive or of the head. The codes of the
trees of six, eight and thirty two leaves are derived from the reference's join rule by hand and compared
with the codes the port's own join hands out. The fixtures also build pictures of the second walk, out of the same head, key walk and checksum: the
table of the places of the colour inside the walked stream of the head, the two trees and the places of the
blocks behind it. Their expectations come from an independent transcription of the transform, the colour
walk and the alpha walk, and they pin a picture of three places to a colour, one whose counts of the
letters carry places below nothing, one with a coded place of the colour on top of them, and one of four
places to a colour with its own alpha places. The fixtures then pin a grey picture of two by two places
(whose expectation is derived by hand: `0, 1, 2` and `3 + (1+2)/2`), a picture of three places to a
colour and one of four, a stream whose sum does not stand, a key of the head that differs, the refusal of
the second walk and of a count of the stored stream below the 0x80 of the reference, and the heads the
reference cannot read.

The fixtures then place the weights inside the walked stream of the head (keyed, and covered by the sum
and the exclusive or) and the coded places behind it in the clear, which is what the reference reads: its
`ReadEncoded` walks the stream of the head and its tree walk then reads bits through the picture itself,
whose stream stands right behind that stream by then. The comment on `unpackCbgFirstWalk` records the
same.
