# Tmr-Hiro ADV System resource archives (PAC)

## Reference and attribution

- GARBro reference: `ArcFormats/Tmr-Hiro/ArcPAC.cs`, class `PacOpener`
- GARBro tag: `PAC/TMR-HIRO`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior. The format has no signature;
its header layout is the gate, so the port registers no signature hints and relies on the structural check.

## Header and version

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 2 | Entry count |
| 0x02 | 1 | Name field width in bytes; zero rejects the archive |
| 0x03 | 4 | Payload area offset |

The payload offset also encodes the version. With `n` entries and a name width `w`:

| Condition | Version | Record tail |
| --- | --- | --- |
| `offset == 7 + (w + 8) × n` | 1 | 32-bit offset, 32-bit size |
| `offset == 7 + (w + 8) × n + 4 × n` | 2 | 64-bit offset, 32-bit size |

The second condition is the same as `7 + (w + 12) × n`, because a version 2 record's tail is four bytes
wider. Any other offset rejects the archive.

Records start at 0x07 and are a fixed-width CP932 name field followed by the tail; offsets are relative to the
payload area. The format is not hierarchical, so names are kept verbatim.

## Payload typing

Every entry's payload is probed, and a probe can rename the entry as well as type it:

| Probe | Result |
| --- | --- |
| First word is `OggS` | Extension becomes `ogg`, type `audio` |
| First byte is 1 or 2 and the archive name contains `grd` | Extension becomes `grd`, type `image` |
| First byte is `0x44` and the word at +5 is `size − 9` | Type `audio` |
| Half-word at +4 is 6 and the word at +6 is `0x140050` | Type `script`; an archive named `srp` also becomes `srp` |

The reference reads those ten bytes with its view, which would throw for a payload that sits within ten bytes
of the end of the archive. The port skips the probe in that case and keeps the entry's name and type, which is
a documented deviation.

## Script payloads

Only script entries are transformed. A 32-bit record count opens the payload and records follow from offset
four: a 16-bit chunk size, a four-byte remainder, then the chunk itself, whose bytes are nibble-swapped
(`RotByteR(x, 4)`). A chunk that would reach past the payload abandons the whole transformation, so the stored
bytes are returned unchanged rather than a partially decoded payload.

## Support

| Capability | Status |
| --- | --- |
| Entry count, name width and payload offset | Supported |
| Version 1 records with 32-bit offsets | Supported |
| Version 2 records with 64-bit offsets | Supported |
| Placement checks and verbatim names | Supported |
| Payload probing for Ogg, image, wave and script entries | Supported |
| Extension renaming for probed entries | Supported |
| Script record decoding with nibble-swapped chunks | Supported |
| Script overflow fallback to the stored bytes | Supported |
| Extension-based typing of unprobed payloads | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover version 1 with an Ogg entry, version 2 with a 64-bit offset, a renamed image in a
`grd` archive, a wave entry, a decoded script, a script whose chunk reaches past the payload, a zero name
length, a payload offset that matches no version, an insane entry count, a payload outside the archive, and a
file too small for its header.
