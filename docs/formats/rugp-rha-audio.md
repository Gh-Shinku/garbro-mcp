# rUGP engine compressed audio

Reference: `GARbro/ArcFormats/rUGP/AudioRHA.cs`, class `RhaAudio`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/rugp/rha-audio.ts` (`rugpRhaAudioDescriptor`, `rugpRhaAudioFormat`, id
`rugp-rha-audio`, `readRhaSchema`, `rhaToMp3Header`, `mp3FrameLength`, `convertRhaToMp3`).

The reference registers no word of its own and no name at all; a sound of this kind is told by the head of its
first step. The sound it hands out is the places of an MPEG Layer 3 sound the reference stands the engine's own
places as.

## The two ways the places of a sound stand

The head of the first step of a sound names the way its places stand:

| the head | the way the places stand |
| -------- | ------------------------ |
| a head whose low places name four, with the place that counts eight places of a colour to a place of it at nought | the places of the sound stand as places of the plain kind: the head of every step stands as the head of a step of an MPEG Layer 3 sound with the places of the engine's own head standing behind it |
| the head naming `0x10B` | the places of every step stand behind a head of the engine's own, which stands as the head of a step of an MPEG Layer 3 sound |

A sound of the plain kind reads its first head twice: the reference stands the file back at its beginning once
it has read the head of its first step, and so does this port.

## The places of a head of the engine's own

Every run of places of such a head stands where the places of a head of an MPEG Layer 3 sound stand: the four
lowest places of the head stand four places up, the places that name the run of places a step stands as stand
five places up, the place that names the way the sound stands stands eight places up, and the rest stand as the
places of a sound whose places stand as places of their own.

## The places of a colour that do not stand in a step

The head of a step of a sound of the second way may name places of a colour that do not stand in the step:

| the places of the head | what stands in the step |
| ---------------------- | ----------------------- |
| the place that counts twelve places of a colour | the words behind the head name how many places of a colour stand at nought, and they stand in the last places of the step |
| the place that counts thirteen places of a colour | the words behind the head name how many places of a colour stand as the places of the highest kind |

Where the head of a step names no places of a colour of its own, the places of such a step stand behind the
places of the step as they stand, two places at a time, which is what the reference does.

## Deviations from the reference

- A file whose head names neither way, a step whose head names the places of a colour of no step, a step that
  names more places of a colour of its own than the step holds, and a sound whose places stand short of a whole
  step are refused with a message or handed out as nothing, which is what the reference does with the last two;
  a sound that is cut short of the head of a step, of the places behind such a head, or of the places of a
  colour of a step, is refused with a message where the reference would throw while reading its stream.
- The reference takes the places behind a head that name how many places of a colour do not stand in a step in
  the other order from the rest of the file; this port reads them the same way.
- The places of a sound are handed out as the places of an MPEG Layer 3 sound the reference stands them as,
  rather than read into a sound of their own, so a file of this kind and a file whose places already stand as
  the places of such a sound hand out the same sound.

## Tests

`tests/formats/rugp-rha-audio.test.ts` covers the places of a head of the engine's own, the places of colour a
step of a sound stands as, the two ways the places of a sound stand, a sound whose steps carry heads of their
own, a sound of no places of a colour of a step, a sound that stands short of a whole step, a sound handed out
as the places of an MPEG Layer 3 sound, and the finding of a sound of its own kind. Both sounds stand over an
independent transcription of the reference's own walk.
