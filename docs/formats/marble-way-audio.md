# Marble engine wave audio format

Reference: `GARbro/ArcFormats/Marble/AudioWADY.cs`, classes `WadyAudio` and `WadyInput`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/marble/way-audio.ts` (`marbleWadyAudioDescriptor`,
`marbleWadyAudioFormat`, id `marble-way-audio`, `readWadyLayout`, `decodeWady`), with the tables of the walk
of the reference (`SizeTable`, `SampleTable`, `SampleTable2`) and the wave writer of
`packages/formats/src/shared/wav.ts`.

The reference registers the word `WADY` and no name at all.

## The head

The file begins with the word `WADY`, the byte at five is what every step of the walk is multiplied by, the
size of the samples stands at `0x0C` and the shape of the sound stands at `0x20` — the kind of the sound, the
channels, the pace, the average, the size of a block and the bits of a sample. The samples themselves stand
from `0x30`.

Where the size the head names is the size of what stands behind the head, the walk takes one byte at a time;
otherwise it takes runs of samples. What is handed out is a wave file: the shape of the head written around
the samples the walk gives.

## The walk of one byte each

Every byte of the walk gives one sample of the left channel; where the sound has more than one channel, one
more byte gives a sample of the right channel, so the two channels stand side by side in the sound and the
walk consumes two bytes a pair. A byte whose highest place stands is a sample of its own, standing nine
places to the left of the byte; any other byte moves the sample along by the value of the walk multiplied by
`SampleTable`, the table being stepped by the byte itself, which may also fall. The samples of the left and
the right channel are each walked from nought and never from the other channel's samples.

## The walk of runs

The walk begins with a sample of its own — two bytes — and then takes an item at a time, the item being one
byte or two. An item whose lowest place stands moves the sample along by what `SampleTable2` gives for the
places above that one, or stands a sample of its own where those places stand at `0x40` and above. Any other
item stands between the sample at hand and the sample its higher places name — the lowest places of the item
standing for the number of samples that stand between them, which is what `SizeTable` gives — and the samples
between the two are stepped evenly, the end of the run being the sample the item names. Where three hundred
items stand behind the walk, the sample begins again at nought.

A sound of one channel walks its runs as they stand. A sound of two channels keeps the size of its second
channel in the four bytes at `0x30`, walks the left channel first and then the right one, which stands at
`0x38` and as far along as that size says, and which begins to write at the second byte of the sound so that
the two channels stand side by side.

## Deviations from the reference

- The reference's own walk of runs writes the very first sample of a channel without stepping over the room of
  the other channel, so the samples of the two channels stand one sample apart at the beginning and the second
  sample of the left channel is covered by the first sample of the right one. The port walks the samples
  exactly as the reference does, quirk and all.
- Where the samples between the two ends of a run are stepped evenly, the port keeps the arithmetic of the
  reference in doubles, so a run ending at a sample the arithmetic of doubles cannot reach exactly is cut
  towards nought — a run of three samples between 256 and 96 gives 202, 149 and 95, not 96.
- The reference's own untouched walk of runs, `Decode2Alt` and `Decode3Alt`, which reads two bytes an item and
  `SizeTableAlt`, stands unused by the reference and is not ported.
- A file whose head is shorter than `0x30`, whose word is not `WADY`, whose size of the samples stands below
  nought or above what this project will hold, or whose sound names no channels is turned away; the reference
  would throw, or run out of memory while holding the sound.
- A walk that runs out of the file is refused with a message, where the reference reads beyond the file and
  throws.

## Tests

`tests/formats/marble-way-audio.test.ts` covers the head, both shapes of a file and a file whose word is not
`WADY`, the walk of one byte each for one channel and for two, the walk of runs for one channel, an item that
stands a sample of its own, the walk of runs of two channels with what the reference's own first write leaves
there, a sound written out as a wave file with the shape of its head, a file that does not hold a sound, and a
walk that runs out of the file. The vectors are worked out by hand: the bytes `0x80`, `0x01`, `0x81` and
`0x02` with a multiplier of two give the samples 0, 4, 512 and 520, and the run of three samples between 256
and 96 gives 202, 149 and 95.
