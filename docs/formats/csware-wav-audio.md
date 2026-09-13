# C's ware encoded audio (WAV/CSWARE)

An eight bit logarithmic sample stream behind a wave-like header: the file carries a RIFF shape, a format byte pair
and a data tag, and the samples are the whole rest of the file expanded through a fixed table into sixteen bit
values. [960405][C's ware] GLO-RI-A ~Kindan no Ketsuzoku~.

## Reference

| Element | Value |
| --- | --- |
| Tag | `WAV/CSWARE` |
| Class | `WavAudio` (`ArcFormats/CsWare/AudioWAV.cs`), priority one — it is tried before generic wave support |
| Signature | `RIFF`, plus three more conditions |
| Header | `0x2E` bytes |
| Extensions | None declared |

## Header

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x00` | 4 | `RIFF` |
| `0x08` | 8 | `WAVEfmt ` |
| `0x14` | 2 | `0x01 0xFF` — the format's own marker |
| `0x16` | 2 | Channels |
| `0x18` | 4 | Sample rate |
| `0x1C` | 4 | Average bytes a second, which the output doubles |
| `0x20` | 2 | Block align, which the output doubles |
| `0x26` | 4 | `data` |
| `0x2A` | 4 | How many samples the file declares |

A plain wave file shares the `RIFF` marker, so the byte pair at `0x14`, the format chunk's name and the data tag
are all part of the probe: the generic wave shape has neither of the first two, which is what keeps this format
apart from it. The reference registers itself at priority one for exactly this reason.

## Decoding

The samples begin at `0x2E` — directly behind the declared size — and run to the **end of the file**, trailing
chunks and all, because the reference decodes from its current position to the stream's end. Each byte indexes a
256 entry table: index 128 is silence, indices above it are built from `10^((i + 44.8637) / 38.0597) - 14.5342`
truncated to a signed word, and the indices below it are their negation — so the table mirrors around silence, with
`0x7F` at minus one and `0x81` at plus one. Index zero is the negative extreme and index 128 stays zero. Golden
values: `0x81 → 1`, `0xA0 → 90`, `0xC0 → 710`, `0xE4 → 6386`, `0xFE → 30842`, `0xFF → 32767`, each with its
negation opposite it, from `0x7F` down to `0x01`.

Each sample becomes two bytes, so the output holds `declared * 2` bytes of audio. The declaration is not a decode
limit: a file holding **more** samples than it declares fails, as the reference's array would, while a file holding
fewer leaves the rest silent.

## Output

A canonical forty four byte wave header — `RIFF`, `WAVEfmt ` with a sixteen byte format chunk, then `data` — in
front of the decoded samples. The format tag is always one and the depth always sixteen bits; the channel count,
sample rate, average bytes and block align come from the file, with the last two doubled as unsigned words, so both
can wrap to zero.

## Process notes

The two doubled words are the interesting part of the port: `AverageBytesPerSecond` is doubled as a `uint` and
`BlockAlign` as a `ushort`, so a fixture with `0x80000000` and `0x8000` in those fields produces zeros in the output
header, which the tests pin.
