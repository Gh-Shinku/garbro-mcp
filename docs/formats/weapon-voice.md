# Weapon voice archive

## Reference and attribution

- GARBro reference: `Legacy/Weapon/ArcVoice.cs`, class `VoiceOpener`
- GARBro tag: `DAT/W/VOICE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Weapon voice archives have no magic signature. A 32-bit entry count sits at offset 0 and the
index size is `count * 4 + 8`. The last index word must equal the file size, and the first
payload offset must not point back into the index. Entries are named
`<basename>#NNNN.wav` and sized by neighbouring offsets.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Trailing size sentinel | Supported |
| Generated WAV names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
