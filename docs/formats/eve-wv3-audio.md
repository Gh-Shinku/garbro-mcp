# Eve compressed audio format

Reference: `GARbro/Legacy/Eve/AudioWV.cs`, classes `Wv3Audio` and `Wv3Decoder`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/eve/wv3-audio.ts` (`eveWv3AudioDescriptor`, `eveWv3AudioFormat`, id
`eve-wv3-audio`, `readWv3Layout`, `decodeWv3`).

The signature word the reference declares is `0x2E335657`, the letters `WV3.`, and the reference checks the
letter `0` behind them as well, so a file has to begin with `WV3.0`; the extensions it declares are `wv3` and
`wav`. The header is thirty eight bytes:

| offset | what it holds |
| --- | --- |
| `0x00` | the letters `WV3.0` |
| `0x06` | the place the stream of blocks stands at |
| `0x0E` | the rate of the samples |
| `0x1A` | how many blocks the sound holds |

The sound is always two channels of sixteen bit samples, with a block of four bytes; the rate of the samples
comes from the header. A sound that holds no block at all is turned away, since it has nothing to unfold.

A block is seventy two bytes: two bytes that choose the weights of the two channels, then thirty five bytes for
the first channel and thirty five for the second, every byte of which holds two four-bit samples, the low one
first. Each byte of the channels picks a pair of weights with its high nibble from a table of eight pairs — a
byte that names a ninth pair is refused, where the reference's own reader would run past the end of the table —
and a count with its low nibble, by which the four-bit sample is shifted up. The sample itself is the two
samples before it of its own channel, the older one weighed by the first weight of the pair and the newer one by
the second, taken eight bits down, with the four-bit sample put on top; the four-bit sample is read as a value
that may stand below nothing before it is shifted. What stands behind the sample for the next one is the wide
value the reference counts in, while the byte of the sound holds the sixteen bits it lands in, which is why an
echo of the wide value can be heard in the samples behind it.

A block unfolds to thirty five frames of four bytes each — the first sample of both channels and then the
second — so a block of the stream is two hundred and eighty bytes of sound. A block the stream is too short for
ends the unfold, leaving the rest of the sound at nothing.

The reference hands the sound out as a stream of raw samples with the format above; the port writes it as a
wave file, which is why the entry it lists is not as long as the file it stands in. The write path of the
reference throws `NotImplementedException`, so this is a read only format, and a sound that would unfold to
more than 256 megabytes is refused.

The tests cover the four bytes of the signature and the letter behind them, the declines of a letter other than
`0`, of a sound of no blocks or of fewer than none, of a header that is not all there and of a block that names
a weight outside the table, the format reported for the sound — two channels, the rate of the header and the
count of the bytes of a block and of a second — the wave file it is written as, with its header and the order
of the samples of its first frames, the four-bit samples read as values that may stand below nothing, the shift
the count of a channel's byte puts on them, the two samples behind a sample weighed as the reference weighs
them, the rest of a sound the stream is short of left at nothing, a block read from anywhere the header says,
and a sound too large to hold.
