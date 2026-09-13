# Uma SDT audio archive

## Reference and attribution

- GARBro reference: `Legacy/Uma/ArcSDT.cs`, class `SdtOpener`
- GARBro tag: `SDT/UMA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2017 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The format only opens files named `.sdt` whose first word is zero or one. There is no index: records follow each other
until the end of the file. A record holds a packed flag, a size word, a null-terminated CP932 name, and a header size.
The stored span is the header size plus the size word, so the next record starts after both. GARbro rejects blank
names, flags other than zero or one, and records that fall outside the file; the port does the same.

## Extraction

`SdtOpener.OpenEntry` does not decode audio. It synthesizes a RIFF/WAVE stream around each entry: `RIFF`, the stored
span plus 0x18, `WAVE`, `fmt `, the header length, the stored format block, `data`, the size word, and then the
payload. Stored payloads are copied verbatim; packed payloads are decoded as a default GARbro LZSS stream that runs
until its input ends.

The reference copies the declared sizes verbatim, so the synthesized `RIFF` size and `data` chunk size can disagree
with the emitted length; the port reproduces those words byte for byte instead of correcting them. Packed entries are
reported with an inexact extracted size. Every entry is classified as WAV audio, matching the reference's
`ChangeType (AudioFormat.Wav)`.

## Support

| Capability | Status |
| --- | --- |
| `.sdt` extension gate and first-word check | Supported |
| Sequential records with a packed flag | Supported |
| CP932 names and placement validation | Supported |
| Stored and unpacked size fields | Supported |
| Synthesized RIFF/WAVE wrapper | Supported |
| Default LZSS extraction | Supported |
| Verbatim payload extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover stored and packed records, extension and blank-name rejection, and out-of-file rejection.
