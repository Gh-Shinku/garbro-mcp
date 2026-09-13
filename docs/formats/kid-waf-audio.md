# KID WAF ADPCM audio

Reference: `GARbro/ArcFormats/Kid/AudioWAF.cs`, class `WafAudio` ("KID ADPCM audio file")
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/kid/waf-audio.ts` (`wafAudioDescriptor`, `wafAudioFormat`, id
`kid-waf-audio`).

| field | offset |
|---|---|
| signature `WAF` | 0 |
| channels (`u16`) | 6 |
| sample rate (`u32`) | 8 |
| average bytes a second (`u32`) | 0xC |
| block alignment (`u16`) | 0x10 |
| bits a sample (`u16`) | 0x12 |
| codec coefficients, thirty two bytes | 0x14 |
| stream size (`i32`) | 0x34 |
| codec stream | 0x38 |

The file is a headerless Microsoft ADPCM stream: the format tag is not stored, because it is always **two**, and
the codec's thirty two bytes of coefficients are. The reference's whole job is to write a wave header in front
of it.

## The header is written by hand, and its sizes are fixed

The wave header is assembled in memory with `BinaryWriter`, and its sizes are constants rather than derived:

* the `fmt ` chunk declares **0x32** bytes, which is the sixteen byte payload plus the extra size word plus the
  thirty two coefficient bytes;
* the extra size word is **0x20**, the same thirty two;
* the `data` chunk sits at offset **70** and the codec stream at **78**;
* the wave's size word is the declared stream size plus **0x46** — everything after the first eight bytes.

The port builds those same bytes, and a test checks every field of the result by offset rather than comparing it
with a fixture built the same way, so the layout is pinned independently of the writer.

## No validation, and the consequences

`TryOpen` reads fifty six bytes and checks nothing beyond the signature being non-null. In particular the word
at 0x34 is never compared with the file length, and the stream it hands to the wave input is a **region over the
rest of the file** rather than a range of the declared size. Two behaviours follow, and both are tested:

* the `data` chunk reports the **declared** size even when the file holds fewer bytes, so a file announcing a
  hundred bytes with six stores a wave whose data chunk overstates itself;
* bytes after the declared size are **kept**, because the region runs to the end of the file.

The port does not add a length check, since a caller looking at the extracted wave should see what the reference
produces — including its inconsistencies. The only guard is that the file is long enough to hold the header.

## Notes

* Coefficients are copied through untouched; a test uses a descending range and checks it is neither shifted nor
  defaulted.
* A zero length stream is accepted and yields a bare seventy eight byte wave.
* The output gains the wave header, so `sizeKnown` is false; the entry points at the stored stream.
* `CanWrite` is false in the reference, so encoding is out of scope.
