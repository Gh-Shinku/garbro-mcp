# Ivory audio format

Reference: `GARbro/ArcFormats/Ivory/AudioCTRK.cs`, classes `PxAudio` and `TrkDecoder`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/ivory/px-audio.ts` (`ivoryPxAudioDescriptor`, `ivoryPxAudioFormat`, id
`ivory-px-audio`, `readPxLayout`, `decodePx`).

## The head

The reference registers the words `cTRK` and, behind them, the words `fPX `, which stand before the head of a
sound of the kind that stands behind words of its own. The words of the head stand behind those, and the words
beside them name how long the places behind the head stand, how long the head stands — which stands at `0x20`
places or more — how many places of a colour the places of the sound stand for, how many places of a colour
stand in a step of the sound, how many places of them stand in a place of a colour, and the kind of the places
behind the head.

## The kinds of the places of a sound

| the kind | the places of the sound |
| -------- | ----------------------- |
| nought | stand as they stand, of the places a step of the sound stands in |
| two | stand walked of their own |
| three | stand as a sound of the Ogg kind |

## The walk of the places of a sound

The places of a sound stand as blocks of eight and twenty places of a colour, every block beginning with the
places of the first place of a colour of the sound and the places of how far the places of the block stand from
it, and every step of the block then naming how far the place it stands for stands from the place before it,
one place of a colour first. A place of a colour stands at the lowest and the highest place of a place of a
colour rather than beside it where the step stands past them.

## Deviations from the reference

- The reference reads the places of a walk without reading how far they stand, so a walk that stops before the
  places of a sound stand is walked as no places at all; this port turns such a sound away.
- The reference reads a head that names no length and a head whose words stand outside the file without turning
  the sound away; this port turns such a head away.
- A sound of a kind the reference does not read is turned away as the reference turns it away, and a sound
  whose words stand as no words of a sound at all is turned away rather than read as a sound of this kind.
- The places of a sound of the plain kind and of the kind that stands walked of their own are handed out as a
  wave, and the places of a sound of the Ogg kind as they stand.

## Tests

`tests/formats/ivory-px-audio.test.ts` covers the head of a sound of the plain kind and of the kind that stands
walked of their own, the heads it is turned away for, the places of a walk and the places they stand for, the
places of a sound of the plain kind and of the walked kind handed out as a wave, a head that stands behind
words of its own, a sound of the Ogg kind, a sound of a kind this project does not read, a walk cut short of
the places of the sound, and the words the sound is told by. The sound of the test stands worked out with a
walk of the places of the reference's own, so its places stand under a walk this port did not work out.
