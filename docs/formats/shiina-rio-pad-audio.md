# ShiinaRio compressed audio (`PAD`)

Reference: GARbro `ArcFormats/ShiinaRio/AudioPAD.cs`, class `PadAudio` and the `PadDecoder` it hands the
packed stream to (GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License). Implemented as
`packages/formats/src/shiina-rio/pad-audio.ts`, registered as `shiina-rio-pad-audio`.

## The header

A file of this kind opens with the word `PAD` in front of a wave header, and the field where a wave file
keeps the length of its samples holds the length of the **decoded** samples instead. The reference reads
0x2C bytes, replaces the word `PAD` with `RIFF` and the field at 4 with the length of the samples plus the
0x24 bytes of chunk headers, and then hands that header and the decoded samples to its own wave reader.

So the header the reader sees is the stored one apart from those two words, which is what this port
reproduces: the fields of the `fmt ` chunk are copied rather than rebuilt, and a sound whose average of bytes
a second is unusual keeps it. The reader insists on the `WAVE` marker, a `fmt ` chunk of at least sixteen
bytes and the `data` marker at 0x24 -- which is where a canonical header of forty four bytes puts them.

## The packed stream

The stream is a run of blocks, and each one opens with a marker byte. A marker of `0xFF` ends the stream;
every other value is stepped over unread. A block then holds:

1. a control byte, whose high nibble is the filter index and whose low nibble is the shift;
2. when the sound has two channels, a byte whose low nibble is the right channel's shift and whose high
   nibble is its filter index. **The byte in front of that one is stepped over unread**, which the reference
   does by reading a byte ahead and advancing by two;
3. fourteen bytes a channel. Each byte carries two residuals: its low nibble is one and its high nibble the
   next, and each is placed at the top of a word and sign extended from the sixteenth bit before it is
   shifted right arithmetically by the shift of its own channel.

Those twenty eight residuals a channel are what a block decodes to.

## The samples

A residual is added to a two tap prediction of the two samples before it, and the coefficient pair comes from
the same table the residuals were loaded into: a filter index picks the pair at `2*index + 2` and
`2*index + 3`. The low slots hold coefficients the reference seeds -- 0.9375 at 4, then 1.796875 and
-0.8125, 1.53125 and -0.859375, 1.90625 and -0.9375 -- while index five and up reach into the residuals of
the block itself, so those indices are self modulating.

The right channel is predicted with its own filter index from its own two previous samples, and the two
channels are interleaved. The state the prediction runs on is **not** reset between blocks, so a block
carries on from the block before it.

Two details of the reference's arithmetic are kept exactly:

* The right channel's shift is stored into the coefficient slot 12 as the **top half of a double**, which
  makes that slot a denormal: the idea is that there is no spare field for it, and the value is far below the
  half a sample is rounded through, so it can never move a sample. This port writes and reads those bits the
  same way rather than dropping the slot.
* `(short)(value + 0.5)` truncates **toward zero** through a thirty two bit word. A residual of -32768
  therefore comes back as -32767, and -4096 as -4095, which is not what rounding away from zero or down
  would give. A value no thirty two bit word can hold becomes the smallest one, as the conversion
  instruction behind the cast produces.

## Deviations from the reference

* The reference allocates its output 0x9C bytes past the length the header declares, which absorbs the last
  block overrunning that length; this is kept, and a stream that overruns even those bytes is refused with
  `INVALID_ARCHIVE` where the reference would run off the end of its own array.
* A stream that ends inside a block, or without its `0xFF` marker, is refused with `INVALID_ARCHIVE`.
* The header is required to hold a one or two channel sixteen bit PCM format, which is what the decoder
  produces; the reference would let its wave reader complain.
* A sound longer than 256 MiB is refused rather than allocated.

## Verification

Fifteen fixtures in `tests/formats/shiina-rio-pad-audio.test.ts` cover a block whose residuals come back as
they stand, including the truncation of the two lowest nibbles, the per channel shift, the seeded single
coefficient and the seeded pair against hand computed values (4096, 3840, 3600, 3375 and 4096, 7360, 9897,
11804), the prediction carrying from one block into the next, both channels interleaved with the byte in
front of the right control unread, the high filter index that reads the slot the shift is kept in, the wave
file whose stored header survives apart from its two patched words, the cut to the declared length, and the
header and stream shapes that are turned away.
