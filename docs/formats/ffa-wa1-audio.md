# FFA System wave audio format

Reference: `GARbro/ArcFormats/Ffa/AudioWA1.cs`, classes `Wa1Audio` and `Wa1Reader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/ffa/wa1-audio.ts` (`ffaWa1AudioDescriptor`, `ffaWa1AudioFormat`, id
`ffa-wa1-audio`, `readWa1Layout`, `readWa1ContainerLayout`, `decodeWa1`, `readWa1Sound`, `buildWa1Wave`),
with the table of the two walks of the engine in `packages/formats/src/ffa/wa-core.ts`
(`WA_SAMPLE_TABLE`, which the second kind of sound of this engine shares).

## The two shapes of a file

The reference registers no word and no name at all, so the shape of a file is what tells it apart.

1. **A plain sound.** The first word of the file is the kind of the sound — nought, four, eight or twelve —
   and the word `RIFF` stands at four. The head of the wave file runs from four to `0x30`: the word `RIFF`,
   the size of the file, the words `WAVE` and `fmt ` with the shape of the sound, the word `data` at `0x28`
   and the size of the walk of the samples at `0x2C`.
2. **A sound whose samples stand wrapped up.** Where the first word stands above twelve it is the size of a
   walk of runs and the second word is what that walk gives; the walk itself stands from the eighth byte and
   runs to the end of the file. What the walk gives is either a wave file of its own — which is handed out as
   it stands — or the plain shape above, which is then walked.

What is handed out is a wave file: the forty four bytes of the head taken from four to `0x30`, with the size
of the file written behind the word at four, and the samples behind them.

## The four kinds of sound

| kind | walk | channels |
| ---- | ---- | -------- |
| 0 | a nibble of a byte, its higher nibble first | one |
| 4 | a code of two to eight places | one |
| 8 | a nibble of a byte, its higher nibble first | two |
| 12 | a code of two to eight places | two |

The walk of a sound of two channels takes the first half of its codes for the left channel and the second
half for the right, and the two stand side by side in the sound. Every channel begins its own walk — the step
of the walk and the sample it gives begin at nought and a hundred and twenty seven — and, for the kind of two
channels that takes a nibble, the walk of the places begins at the byte at hand. The places a sound of the
fourth kind holds carry over from one channel to the other, which is what the reference's own walk of the
places does.

The code of a nibble is what the nibble gives. The code of the four kinds that take a code of places is read
out of those places, the lowest place first, and the code stands in the places `10`, `00`, `101`, `001`,
`1011`, `0011`, `10111`, `00111`, `101111`, `001111`, `1011111`, `0011111`, `01111111`, `11111111`,
`10111111` and, where none of those stand, in eight places.

What a code gives is the step the walk stands at times the odd number its three lowest places name, less
three places of the same; the sample climbs by that or — where the highest place of the code stands — falls by
it, held at the greatest and the least of sixteen bit samples. The walk then moves along: the step it stands
at times what `WA_SAMPLE_TABLE` gives for the code, less six places, held at a hundred and twenty seven where
that stands below it and at `0x6000` where it stands above. The two kinds of sound that take a code of places
share this walk with the second kind of sound of this engine, which is why the table stands in a file of its
own.

## Deviations from the reference

- Detection is structural. The reference unwraps the walk of runs while it opens a file and looks at what
  comes out; the port reads the word that tells the two shapes apart and unwraps the walk only where a sound
  is handed out. A file whose walk of runs gives neither a wave file nor a sound of this engine is therefore
  turned away with a message where the reference turns it away while opening it.
- The port reads only the four kinds of sound the reference's own walk of the samples knows; the kind word of
  a plain sound is taken into account while a file is recognised, where the reference refuses a kind it does
  not know while unwrapping it.
- A sound whose walk runs out of the file is refused with a message; the reference reads beyond the file and
  throws. A file whose samples stand behind the head is not required to hold the whole of them, which the
  reference does not require either: what the walk does not give stands as nought.

## Tests

`tests/formats/ffa-wa1-audio.test.ts` covers the recognition of every kind and of a file whose word is not
`RIFF`, the walk of a nibble of the first kind, the walk of a code of the second kind, the two channels of
the third and the fourth kinds, a sound written out as a wave file with the size written behind its word, a
sound unwrapped from a walk of runs, a wave file the walk of runs already holds, a file that does not hold a
sound, and a walk that runs out of the file. The four vectors of the walk are worked out by hand: the codes
nought, eight, five and thirteen give the samples 15, nought, 174 and minus 103 — the codes nought and eight
leave the step at a hundred and twenty seven, the code five climbs by a hundred and seventy four and moves
the step to two hundred and two, and the code thirteen falls from there by two hundred and seventy seven.
