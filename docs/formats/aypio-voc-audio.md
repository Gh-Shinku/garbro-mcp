# UK2 engine compressed audio

Reference: `GARbro/Legacy/AyPio/AudioVOC.cs`, classes `VocAudio` and `VocDecoder`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/aypio/voc-audio.ts` (`aypioVocAudioDescriptor`,
`aypioVocAudioFormat`, id `aypio-voc-audio`, `readVocLayout`, `buildVocSamples`, `decodeVoc`), with the steps
of the walk of the reference (`StepTable`, `IndexTable`) and the wave writer of
`packages/formats/src/shared/wav.ts`.

The reference registers the word `WAV\x81` and no name at all.

## The head

The head of the file is thirty six bytes wide. The word `RIFF` stands at `0x38`; behind the word `fmt ` at
`0x1D` the head carries the shape of the sound — the kind of the sound, the channels, the pace, the average,
the size of a block and the bits of a sample — and, further back, how many samples the sound holds at `0x18`,
the step the walk of each channel stands at at `0x0C` and `0x10`, the first sample of the sound in two halves
at `0x0A` and `0x0E` (the lower halves) and `0x0B` and `0x0F` (the higher ones), and two parts of where the
walk of the sound begins at `0x04` and `0x14`, which are added up. The walk of the sound begins behind the
head.

What is handed out is a wave file: the shape of the head written around the samples the walk gives.

## The steps of the walk

The steps of the walk are worked out for every place of a sample. There are eighty nine steps, the values of
`StepTable`, and a sample of `b` places of a step gives `b` values: the value of a place is the sum, over the
parts of the step table — the places of a sample halved again and again, down to one — of the part of the step
which stands wherever the places of the sample that stand below that part say so. The values of a step are
held together, one step after another.

## The walk of the sound

The walk takes the lower nibble of a byte first and the higher nibble behind it, and a new byte only every
other step. The nibble names a step of the walk by its three lowest places and says by its highest place
whether the sample climbs or falls. The walk of a sample of one channel stands at the one step the head names;
the walk of a sound of two channels stands at two steps, and every other step of the walk moves its own
channel along.

What the walk does is read the sample at the place it has already written, add or take what the steps of the
walk give for the nibble and the step, hold the sum at the greatest and the least of sixteen bit samples, and
write it at the place behind the one it read — so the sample the walk writes always stands one step behind the
one it read, the first sample of the sound standing in the head and the last sample of every channel standing
as nought. The step of the channel then moves along the steps of the walk by what `IndexTable` gives for the
nibble, held between the first and the eighty ninth step.

## Deviations from the reference

- A file whose word is not `WAV\x81`, whose head does not hold the word `RIFF` at `0x38`, whose head does not
  stand in the file, whose sound names no channels or no bits of a sample, whose sample count stands below its
  channels or above what this project will hold, or whose walk begins beyond the file is turned away; the
  reference would throw, or run out of memory while holding the sound.
- A walk that runs out of the file is refused with a message, where the reference reads beyond the file and
  throws. A sound of fewer than two samples cannot hold the first sample the head names; the port leaves it
  out, where the reference writes beyond its own array.
- The reference reads the shape of the sound and the wave writer writes the very shape the head carries,
  including the bits of a sample the head names behind the word `fmt `, which is not the byte the walk of the
  sound is worked out with.

## Tests

`tests/formats/aypio-voc-audio.test.ts` covers the steps of the walk of a sample of four bits, the head, a
file whose word is not the word of the reference and a file without the word `RIFF`, the walk of one channel,
the walk of two channels, a sound written out as a wave file with the shape of its head, a file that does not
hold a sound, and a walk that runs out of the file. The vectors are worked out by hand: the first step of the
walk gives the places 0, 2, 4, 6, 7, 9, 11 and 13, and the nibbles `1`, `0`, `9`, `8` and `2` step the first
sample of the sound — 256 — to 258, 258, 256, 256 and 260.
