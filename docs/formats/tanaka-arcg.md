# Tanaka ARCG resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Tanaka/ArcARCG.cs`, class `ArcGOpener`
- GARbro tag: `ARCG`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The signature spells `ARCG`, the word at 4 is a fixed marker, and the index offset, index size, directory count
and entry count follow it. The index is hierarchical, and its two record kinds are laid out in *separate runs*:
every directory record comes first, and the file-record blocks follow them, each directory reaching its own block
through an absolute index offset stored in its record. The reference walks directory records with a single cursor,
so an index that interleaved the two kinds would not parse — the port's own first fixture made that mistake.

A name field is a length byte, the name, and a terminator, with the stored length counting all three, so the name
itself is one byte shorter. `?` characters in file names are replaced with the full-width form, and each entry's
name is joined to its directory's. Payload offsets are validated against the archive and payloads are stored
verbatim; the reference's content-signature type pass is left out.

## The companion index

An index offset of zero means the real index lives in a sibling `.bmi` file, which the reference decrypts with a
keystream whose seed comes from a passphrase. That passphrase is either configured per volume serial number or
read from the Windows volume itself through `GetVolumeInformation`, so an archive of this kind is bound to the
medium it shipped on and cannot be opened elsewhere — not by this port, and not by GARbro on a different volume
either. Only the embedded layout is handled here, and the companion case is rejected explicitly.

## Support

| Capability | Status |
| --- | --- |
| `ARCG` signature, marker and header fields | Supported |
| Registered extensions (`arc`, `bmx`, `scb`, `vpk`) | Supported |
| Directory records followed by file-record blocks | Supported |
| Absolute directory offsets into the index | Supported |
| Name lengths counting the length byte and terminator | Supported |
| Full-width question mark replacement | Supported |
| Entry placement validation | Supported |
| Verbatim extraction | Supported |
| Companion `.bmi` index with its volume-bound key | Not supported beyond rejection |
| Archive creation | Unsupported |

Synthetic fixtures cover two directories, the question mark replacement, the companion-index path, an entry whose
payload leaves the file, and the extension requirement. The layout insight above came from the first fixture
failing against a port that was already a faithful transcription.
