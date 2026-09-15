# Mermaid compressed audio

Reference: `GARbro/Legacy/Mermaid/AudioPWV.cs`, class `PwvAudio`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/mermaid/pwv-audio.ts` (`mermaidPwvAudioDescriptor`,
`mermaidPwvAudioFormat`, id `mermaid-pwv-audio`, `hasPwvHeader`, `unpackPwv`).

A stream of this format opens with a NUL and then with a wave of its own, so the word `RIF` sits where a wave
would carry it and `WAVE` sits four bytes further on than usual. The reference reads this format **from the
name alone** as well: a file whose extension is not `pwv` is never claimed, however much it opens like one.

The stream is a wave that has been widened, or narrowed, a block at a time, and every opcode writes a whole
block of sixteen bytes:

| opcode | meaning |
| --- | --- |
| `0` | the sixteen bytes behind it are the block, exactly as they are |
| `1` | eight bytes are read and a byte of nothing is put behind each of them |
| `8` | eight bytes are read and a byte of ones is put behind each of them |
| `15` | the byte behind the opcode is the length of the block, and the bytes behind that are the block |
| anything else | refused — unless the stream has already ended behind it, where it is simply the last byte |

Two quirks are kept. A block the stream cannot fill is written from the block of the op before it, so a
truncated stream repeats what it read last instead of failing; and a block longer than sixteen bytes hands the
reader a **fresh** block of nothing, so whatever the block held before it is lost when it grows. An opcode
that ends the stream on its own byte is not an error. An opcode that needs bytes the stream does not hold —
the length byte of a block, or a byte of a widened sample — is refused with `INVALID_ARCHIVE`, as is an opcode
the format does not know with data behind it. A stream that unfolds to more than 256 MB is refused with
`LIMIT_EXCEEDED`.

The reference unpacks the whole stream while opening it, so a broken stream fails there rather than in the
read; this port keeps the unpacking in the read, which is where every other format here does it. Nothing else
is changed, and nothing here writes the format: `CanWrite` is false in the reference.

The tests cover finding a stream of the format's own name and declining any other, a stream with no wave
behind its NUL, the name of the entry and the kind of its contents, a block copied verbatim, samples widened
with a byte of nothing and with a byte of ones, a block whose length comes from the byte behind its opcode,
the block a truncated stream repeats, an opcode the format does not know, an opcode that ends the stream, and
a stream that ends inside an opcode.
