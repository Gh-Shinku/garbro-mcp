# IPAC WST ADPCM audio

Reference: `GARbro/ArcFormats/Ipac/AudioWST.cs`, class `WstAudio` (in `GameRes.Formats.BaseUnit`)
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/ipac/wst-audio.ts` (`wstAudioDescriptor`, `wstAudioFormat`, id
`ipac-wst-audio`).

| field | offset |
|---|---|
| signature `WST2` | 0 |
| never read | 4 |
| seven coefficient pairs, twenty eight bytes | 0xC |
| ADPCM stream | 0x28 |

## The one check the format has

`TryOpen` seeks to twelve and reads twenty eight bytes into the **middle** of a thirty two byte buffer — the
coefficients land at index four — and returns null if that read comes up short. Nothing else is examined:
bytes zero to eleven are never read, because the signature is all that identifies the file, and the byte at
twelve is the first coefficient byte rather than a field.

That makes the completeness of the read the format's only validation, and it has a consequence worth naming: a
truncated file is **not recognised at all**, rather than being listed and failing later. A test checks files of
four, twelve and twenty seven bytes are declined, which is what the metadata read has to do since `readLayout`
would otherwise seek past the end.

## A fixed format chunk, and two values that look computed but are not

The wave header is written field by field with constants, and the port does the same, which is why a test can
pin every field by offset:

| field | offset | value |
|---|---|---|
| `fmt ` chunk size | 16 | 0x32 (fifty: sixteen, the extra size word, and thirty two) |
| format tag | 20 | 2, ADPCM |
| channels | 22 | 2 |
| sample rate | 24 | 0xAC44 |
| average byte rate | 28 | 0xAC44 |
| block alignment | 32 | 0x800 |
| bits a sample | 34 | 4 |
| `cbSize` | 36 | 0x20 |
| samples a block | 38 | 0x07F4 |
| coefficient count | 40 | 7 |
| coefficients | 42 | the file's twenty eight bytes, verbatim |

**The byte rate is the sample rate.** It is not derived from the block alignment or anything else, so a strict
reader would find it inconsistent with 2048 byte blocks; the port writes it as the reference does and a test
says so in a comment rather than quietly computing something plausible.

**The extra data is assembled, not read.** The first four bytes — 0x07F4, then the count of seven and a zero
the allocation left behind — come from the code, and only the coefficients come from the file. Reading them as
one twenty eight byte block is the easy mistake here; the first version of the port did exactly that and put
the file's byte at twelve into the coefficient count. The coefficients are the bytes at 0x0C through 0x27,
which is what a test asserts after filling them with a descending range.

## The stream and the sizes

The `data` chunk's declared size is everything from the coefficients' end to the end of the file, and the
`RIFF` size is that plus **70** — the header's seventy eight bytes less the first eight. A file that ends right
after the coefficients is accepted and produces a wave with an empty chunk, which a test checks. Because the
extraction gains a header, `sizeKnown` is false and the entry points at the stored file.

## Notes

* The depth, channel count and rate are all fixed by the format; none is read from the file.
* No extension is declared, and the reference registers none, so this is a pure signature match.
* `file.Dispose()` in the reference releases the source once the wave is built, which the port has no
  equivalent for — the returned stream owns its bytes.
