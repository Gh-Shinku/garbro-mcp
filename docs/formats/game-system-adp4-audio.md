# 'GameSystem' compressed audio

Reference: `GARbro/ArcFormats/GameSystem/AudioADP4.cs`, classes `Adp4Audio` and `AdpDecoder`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/gamesystem/adp4-audio.ts` (`gameSystemAdp4AudioDescriptor`,
`gameSystemAdp4AudioFormat`, id `game-system-adp4-audio`, `adp4Kind`, `readAdp4Layout`, `decodeAdp4Bits`,
`decodeAdp4Adps`, `decodeAdp4`).

A sound of this engine is found by **its name alone** — `adp4` or `adps`, the two kinds the reference reads —
and has to hold more than four bytes. What is handed out is a wave file of two channels of sixteen bit samples
at forty four thousand one hundred samples a second, which is the pace the reference gives every sound of this
engine rather than one the file carries.

The first word of the file says how many steps of samples it holds. Where the kind is the second one, that
word is also **where a second word stands**, and the second word says how many steps stand behind it: the walk
of the second kind begins behind that other word.

The walk of the first kind begins every run behind a byte whose lowest place says what the run is, and every
run behind one or two bytes that count it — a count whose highest place stands fits in the one byte, and any
other stands two bytes wide. A control whose place stands is a run of silence: the steps it names are passed
over and stand as nought. A control whose place does not stand is a run of steps, and every byte of it holds
two of them, the four lower places first and the four places above them second. Every step is a byte of the
file exclusive ored with the place of a key that climbs by one with every byte read, added to where the walk
of that channel stands, which is then moved along the table `AdpSamples` and `AdpAdjust` of the reference.
Every step is written twice over: two steps of a byte take eight bytes of the sound.

The walk of the second kind reads a word of two bytes for every two steps, and every word carries **both
channels at once**: the four lower places are the left channel and the four places above them the right, and
the eight places above those are the same two again. Every channel keeps its own place in the table of the
walk, and the two samples of a step are written together as one word of four bytes, the left channel first and
the right behind it. What the walk writes is half of what the head gives, the rest standing as nought, which
is what the reference's own arithmetic of that walk does.

Deviations from the reference, in the message only: a file that is not one of the two kinds, a file of four
bytes or less, a head that does not stand inside the file, and a walk that runs out of the file are refused,
where the reference would throw an `InvalidFormatException` or an exception of its own stream.

The tests cover the head of both kinds and where the second kind begins, the kind taken from the name and the
kinds without one, a run of steps of the first kind worked out place by place, a run of silence, a walk of the
second kind with both channels at once, a sound written out as a wave, a walk that runs out of the sound, and a
file that does not hold a sound.
