# Aaru compressed audio

Reference: `GARbro/Legacy/Aaru/AudioWV1.cs`, classes `Wv1Audio` and `Wv1Decoder`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/aaru/wv1-audio.ts` (`aaruWv1AudioDescriptor`,
`aaruWv1AudioFormat`, id `aaru-wv1-audio`, `readWv1Layout`, `decodeWv1`, `Wv1Decoder`).

The head begins with `WV1.0` and a nought; the channel count stands at `0xA` as a word, the sample rate at
`0xE` as a word, the depth is always sixteen bits, and the count of samples — of every channel taken
together — stands at `0x26` as a word. The samples follow the head, two to every byte.

`Wv1Decoder` takes its step from a table of a hundred and twenty eight entries at the place of its own
index, and builds seven more from it — an eighth, a quarter and a half of the step, and the step itself with
each of them added. A code's low three bits choose one of the eight, and its fourth bit says which way the
step goes; the index then moves by the code: down one for the four smallest, and up by two, four, six or
eight for the rest, never past the table's end. The value handed out is the walk's own doubled, and every
step of the arithmetic is a **signed word**, which is what the reference's own `short` fields do to it.

A byte's **low** nibble is the sample of an even place and its high nibble the sample of the odd place
behind it. A sound of one channel decodes both with the same walk, so its own state carries from one to the
next; a sound of two channels gives every other sample to a walk of its own. Where the stream ends before
the count is reached the sound ends quietly, which is what the reference's own `-1` check does; the bytes
behind it stand as noughts.

Deviations from the reference, in the message only: a channel count other than one or two is refused. The
reference's write path throws `NotImplementedException`, so this is a read only format.

The tests cover the head and the fields it is turned away for, a step of the sample table, the wave of a
sound of one channel, the two walks of a sound of two channels, a stream that ends before its own count, and
a file that does not hold a sound.
