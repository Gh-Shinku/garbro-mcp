# Maika sound format

Reference: `GARbro/ArcFormats/Maika/AudioWV5.cs`, classes `Wv5Audio` and `Wv5Decoder`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/maika/wv5-audio.ts` (`maikaWv5AudioDescriptor`, `maikaWv5AudioFormat`,
id `maika-wv5-audio`, `readWv5Layout`, `decodeWv5`), with the wave builder of
`packages/formats/src/shared/wav.ts`.

The reference registers the word `WV5A` and the name `wv5`.

## The head

words at `0x06`, how many places of it stand in the words at `0x0A` and how many steps the walk of its places

## The walk of runs

colour beside the place before it:

| the first place of a step | what the step stands |
| ------------------------- | -------------------- |
| nought | the place behind it names how many places stand, every one of them standing a place of its own |
| one | two hundred and fifty six places stand, every one of them standing a place of its own |
| two | a place follows that stands two places |
| three | the words behind the first place name how many places stand, and one place follows that stands them all |
| any other place | as many places stand as it names, and one place follows that stands them all |

the walk one after the other.

## Deviations from the reference

- A file of fewer than four and twenty places, a file that does not hold the word of the format, a sound whose
  places of a colour stand beside anything but a whole number of twos, a sound of no places, and a sound of no
  steps of the walk are turned away; the reference would throw while reading its head.
- A walk that stands short of its own places, and a walk that names more places than the sound holds, are
  places stand than the sound holds.
- The places of a sound stand as a wave of the plain kind, which is what the reference hands out as places of a
  sound of its own and what any reader of its own would stand as a wave.

## Tests

`tests/formats/maika-wv5-audio.test.ts` covers the head and the words it is turned away for, a sound of no
places of its own and one whose places of a colour do not stand beside a whole number of twos, the walk of runs
that stands outside the sound, the wave a sound hands out, and the finding of a sound of its own kind. The
them.
