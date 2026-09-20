# rUGP engine compressed audio

Reference: `GARbro/ArcFormats/rUGP/AudioRHA.cs`, class `RhaAudio`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/rugp/rha-audio.ts` (`rugpRhaAudioDescriptor`, `rugpRhaAudioFormat`, id
`rugp-rha-audio`, `readRhaSchema`, `rhaToMp3Header`, `mp3FrameLength`, `convertRhaToMp3`).

places as.

The head of the first step of a sound names the way its places stand:

| the head | the way the places stand |
| -------- | ------------------------ |

A sound of the plain kind reads its first head twice: the reference stands the file back at its beginning once
it has read the head of its first step, and so does this port.

## The places of a head of the engine's own

five places up, the place that names the way the sound stands stands eight places up, and the rest stand as the

## The places of a colour that do not stand in a step

The head of a step of a sound of the second way may name places of a colour that do not stand in the step:

| ---------------------- | ----------------------- |

## Deviations from the reference

  names more places of a colour of its own than the step holds, and a sound whose places stand short of a whole
  step are refused with a message or handed out as nothing, which is what the reference does with the last two;
  colour of a step, is refused with a message where the reference would throw while reading its stream.
- The reference takes the places behind a head that name how many places of a colour do not stand in a step in
  the other order from the rest of the file; this port reads them the same way.

## Tests

own, a sound of no places of a colour of a step, a sound that stands short of a whole step, a sound handed out
independent transcription of the reference's own walk.
