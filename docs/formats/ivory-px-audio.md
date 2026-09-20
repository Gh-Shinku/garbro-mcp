# Ivory audio format

Reference: `GARbro/ArcFormats/Ivory/AudioCTRK.cs`, classes `PxAudio` and `TrkDecoder`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/ivory/px-audio.ts` (`ivoryPxAudioDescriptor`, `ivoryPxAudioFormat`, id
`ivory-px-audio`, `readPxLayout`, `decodePx`).

## The head

The reference registers the words `cTRK` and, behind them, the words `fPX `, which stand before the head of a
sound of the kind that stands behind words of its own. The words of the head stand behind those, and the words
beside them name how long the places behind the head stand, how long the head stands — which stands at `0x20`
behind the head.

| -------- | ----------------------- |
| two | stand walked of their own |
| three | stand as a sound of the Ogg kind |

The places of a sound stand as blocks of eight and twenty places of a colour, every block beginning with the
it, and every step of the block then naming how far the place it stands for stands from the place before it,
one place of a colour first. A place of a colour stands at the lowest and the highest place of a place of a
colour rather than beside it where the step stands past them.

## Deviations from the reference

  places of a sound stand is walked as no places at all; this port turns such a sound away.
- The reference reads a head that names no length and a head whose words stand outside the file without turning
  the sound away; this port turns such a head away.
- A sound of a kind the reference does not read is turned away as the reference turns it away, and a sound
- The places of a sound of the plain kind and of the kind that stands walked of their own are handed out as a

## Tests

`tests/formats/ivory-px-audio.test.ts` covers the head of a sound of the plain kind and of the kind that stands
places of a sound of the plain kind and of the walked kind handed out as a wave, a head that stands behind
words of its own, a sound of the Ogg kind, a sound of a kind this project does not read, a walk cut short of
