# UK2 engine DLB archive (version 0)

## Reference and attribution

- GARBro reference: `Legacy/AyPio/ArcDLB.cs`, class `Dlb0Opener`
- GARbro tag: `DLB/V0`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The zero version drops the signature and detects itself through the `.DLB` extension alone. The entry
count sits at 0 and the index starts at 2, but records keep the same 0x15-byte width as the 1.00
version — a fixed 0xD-byte name field, then the data offset and the size.

Because nothing identifies the layout directly, GARbro pins it down with an alignment check: the word
at 0xF, which is the first record's data offset sitting right behind the header and its name field,
must equal the end of the index, that is `count * 0x15 + 2`. The port keeps that check as the detection.
Payloads are stored verbatim and offsets are absolute.

## Support

| Capability | Status |
| --- | --- |
| `.DLB` extension requirement | Supported |
| Entry count validation | Supported |
| Index at offset 2 with 0x15-byte records | Supported |
| First offset alignment check as detection | Supported |
| CP932 filenames | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a two-entry archive, the extension requirement, and a first offset that does
not match the index end.
