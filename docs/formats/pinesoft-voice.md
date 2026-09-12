# PineSoft voice archive

## Reference and attribution

- GARBro reference: `Legacy/PineSoft/ArcVoice.cs`, class `CmbAudioOpener`
- GARBro tag: `CMB/VOICE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

PineSoft voice files have no magic signature. A 32-bit header size sits at offset 0 and a
32-bit entry count at 0x24; the header size must equal `(count + 1) * 4 + 0x28`. The offset
table starts at 0x28 and holds one extra sentinel entry, and the sentinel must equal the file
size. Entries are named `<basename>#NNNNN` and sized by neighbouring offsets.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Header size validation | Supported |
| Sentinel offset validation | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
