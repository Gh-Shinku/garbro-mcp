# Tanaka WSM1 music archive

## Reference and attribution

- GARBro reference: `ArcFormats/Tanaka/ArcWSM.cs`, class `Wsm1Opener` with `Wsm0Opener`
- GARbro tag: `WSM1`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

This version shares the whole index walk of its version zero sibling — the index as the file's first
`index_size` bytes, pointers into that buffer, and a name whose length counts its own terminator — but it stores
a wave format with every entry instead of assuming one. The format block sits right behind the name: a channel
byte, a bits-per-sample byte and a sample rate word, from which the reference derives the block alignment and the
average byte rate.

Extraction is inherited unchanged, so a payload is emitted behind the canonical 44-byte wave header and the
extracted span is 0x2C bytes longer than the stored one.

## Support

| Capability | Status |
| --- | --- |
| `WSM1` signature and shared index walk | Supported |
| Per-entry channel, bits and sample rate fields | Supported |
| Derived block alignment and average byte rate | Supported |
| Synthesized wave header | Supported |
| Entry placement validation | Supported |
| Inexact size marking for synthesized entries | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a mono eight-bit entry at 22.05 kHz with its expected header.
