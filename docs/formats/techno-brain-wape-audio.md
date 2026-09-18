# TechnoBrain's compressed audio

Reference: `GARbro/ArcFormats/TechnoBrain/AudioWAPE.cs`, classes `WapeAudio` and `WapeDecoder`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/techno-brain/wape-audio.ts` (`technoBrainWapeAudioDescriptor`,
`technoBrainWapeAudioFormat`, id `techno-brain-wape-audio`, `readWapeLayout`, `decodeWape`).

The file has to carry the marks `RIFF` at nought, `WAPEfmt ` at eight and `data` at `0x24`, with the wave's
own format fields between `0x14` and `0x22` — the format tag, the channel count, the sample rate, the average
bytes and the block alignment. The size of the wave the walk builds stands at `0x2C` as a word, and the walk
of bits begins right behind it. Those format fields are handed on to the wave this port writes, as the
reference hands them to its own `RawPcmInput`.

`WapeDecoder.GetBits` takes a count of bits from the highest bit of a byte downwards and leaves them at the
same heights in the value it hands back: a count of two therefore gives `0x00`, `0x40`, `0x80` or `0xC0`,
and a count of seven leaves the lowest bit of the byte clear, so a byte that stands itself is always even.

Every step of the walk begins with a bit. A clear one is a byte that stands itself; a set one is followed by
another bit, which says whether the step is a run or a change:

* a **change** is told apart by two more bits, of four or two, up or down, and the third bit chooses which of
  the two sizes;
* a **run** is of the byte before, of up to four bytes, told apart by five more bits.

Where a step leaves the last byte written as `0xFE` it is written as `0xFF` instead. The reference's own
escape from the five bits to a longer run can never be taken, since those five bits only reach three once
they are shifted; it is kept here as it stands.

Deviations from the reference, in the message only: a stream that ends, a step or a run with no byte before
it, and a run that reaches past the wave are refused, where the reference would read or write past its own
array. The reference's write path throws `NotImplementedException`, so this is a read only format.

The tests cover the head and the fields it is turned away for, a literal, a small step and a larger one, a
run of the byte before, a byte of `0xFE`, the wave written out with its own format fields, a step with no
byte before it, and a file that does not hold a sound.
