# Black Cyc audio format

Reference: `GARbro/ArcFormats/BlackCyc/AudioVAW.cs`, class `VawAudio`, over the head of
`ArcFormats/BlackCyc/ImageDWQ.cs`, class `ResourceHeader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/black-cyc/vaw-audio.ts` (`blackCycVawAudioDescriptor`,
`blackCycVawAudioFormat`, id `black-cyc-vaw-audio`, `readVawHeader`, `readVawSound`, `decodeVaw`).

The reference registers no word of its own and the names `vaw` and `wgq`. The head of a file of this kind
serves the pictures of the same engine as well, which stand under the head of
`ArcFormats/BlackCyc/ImageDWQ.cs`; those are not read here.

## The head

The kind of the places of a file stands as the words at `0x30` of the first four and sixty places of it, which
stand as `PACKTYPE=` and how many places the kind names, the places behind them standing as nothing, and a
place standing behind those naming a picture of the engine rather than a sound.

## The kinds of the places of a sound

| the kind | where the places of the sound stand |
| -------- | ----------------------------------- |
| nought | a wave stands behind the head, whose own words stand in the four and sixty places behind it |
| one | the places of the sound stand as a walk of their own behind the head |
| two | a sound of the Ogg kind stands behind the head, and its words stand in the four places behind the hundred and eight places of it |
| six | a sound of the Ogg kind stands behind the head, its word standing in the words at `0x10` |

A kind the reference does not know, and a kind whose places do not stand where the table names them, stand as
no sound at all.

## The walk of places of a sound of its own

The wave header of such a sound stands behind the head and the places of the sound behind those: the words at
`0x04` of the wave header name how many places the wave the sound stands holds, the words at `0x10` how many
places the words that name how the places of the sound stand hold, and the places of the sound stand behind
those words. The places of the sound stand as a wave of the plain kind, two places of a colour apiece.

Every step of the walk of places names how many places of a colour stand, and stands one place of the sound
beside the place before it: the place of the sound stands as the places the step names, the places behind the
first of them standing over the places before them, and every place of the sound then stands beside the place
before it of the sound.

## Deviations from the reference

- A file of fewer than four and sixty places, a file whose words at `0x30` do not name a kind, a sound of a
  kind the reference does not read, a sound whose places do not stand where the table of its kind names them,
  and a sound whose wave header does not stand whole are turned away; the reference would throw while reading
  those words.
- A walk of places that stops behind the places of the sound stands the place before every place that names
  none, which is what the reference stands where its own walk of places stands at the end of the file.
- A sound of the kinds that stand as a sound of their own is handed out as the places behind the head stand,
  which is what the reference hands to the kinds of sound that read them.

## Tests

`tests/formats/black-cyc-vaw-audio.test.ts` covers the head and the kinds it is turned away for, where the
places of a sound of its own kind stand, a sound of a kind the reference does not read, a sound whose places do
not stand where its kind names them, the walk of places of a sound of its own, the places of a walk that stops
behind the sound, the wave a sound of its own kind hands out, a sound of a kind that stands as a sound of its
own, and the finding of a sound of its own kind. The sound of the test stands worked out with a walk of the
places of the reference's own, so its places stand under a walk this port did not work out.
