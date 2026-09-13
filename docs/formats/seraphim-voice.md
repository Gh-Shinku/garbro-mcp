# Seraphim engine voice archive

## Reference and attribution

- GARBro reference: `ArcFormats/Seraphim/ArcVoice.cs`, class `VoiceDatOpener`
- GARBro tag: `SERAPH/VOICE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Only files whose name matches `Voice<one digit>.dat` or `Voicepac.dat` qualify, so the port keeps that
gate exactly, including its single-digit requirement. A 16-bit record count sits at 0 and the layout
that follows depends on whether the word at 2 looks like a data offset that starts behind the index:

- the offset-chain variant stores one 32-bit offset per record, names entries `*.wav`, and lets every
  entry run up to the next offset with the last one reaching the end of the file; and
- the record variant stores twelve-byte records with an offset and a size, naming entries `*.ogg`.

Payloads are extracted raw.

## Support

| Capability | Status |
| --- | --- |
| File name pattern detection | Supported |
| Offset-chain variant | Supported |
| Record variant with offset and size | Supported |
| Variant selection | Supported |
| Non-increasing offset rejection | Supported |
| Entry placement validation | Supported |
| Generated entry names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover both variants, the name pattern gate, and offset-order rejection.
