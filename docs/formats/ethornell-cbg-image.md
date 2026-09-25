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

The walked stream holds the weights of the leaves first: 0x100 counts, seven bits to a letter with the
high bit of the last one clear. The weights are joined two at a time, the lightest first and the lower
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

## The second walk, which this port does not carry

Version 2 hands the picture over as blocks of eight by eight places: two weight tables of 0x10 and 0xB0
leaves stand at the head of the stream, then the offsets of the blocks of rows, then a run of blocks, each
with a difference of a base place and a coded run of places of a colour, and then a walk of the alpha
channel of a thirty two bit picture. The places of a block are turned by the discrete cosine transform of
the reference's own table, and the colours of a block are then read out of the three channels as full
range YCbCr. The reference walks the blocks of rows side by side with `Task.Run`; each block writes a
region of its own, so a port can walk them one after another and lay down the same bytes.

The second walk is refused with `UNSUPPORTED_FEATURE`, both in the record of this format and in the tests.

## Tests and deviations

`tests/formats/ethornell-cbg-image.test.ts` builds its fixtures out of the reference's own head, key walk
and weight tables: the weights of a tree of one weight each, the places of the walked stream coded by
hand, the key laid over every stored place, and the sum and the exclusive or of the head. The codes of the
trees of six, eight and thirty two leaves are derived from the reference's join rule by hand and compared
with the codes the port's own join hands out. The fixtures then pin a grey picture of two by two places
(whose expectation is derived by hand: `0, 1, 2` and `3 + (1+2)/2`), a picture of three places to a
colour and one of four, a stream whose sum does not stand, a key of the head that differs, the refusal of
the second walk and of a count of the stored stream below the 0x80 of the reference, and the heads the
reference cannot read.

One deviation stands in the reading of the codes of the first walk. The reference reads the weights from
the walked stream and then reads the codes through the bit reader of the picture itself, whose stream
stands past the walked stream by then; this port reads the codes from the walked stream, right behind the
weights, which is where the sum and the exclusive or of the head say they stand. The comment on
`unpackCbgFirstWalk` records the same.
