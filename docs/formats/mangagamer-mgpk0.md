# MG resource archive, version 0

## Reference and attribution

- GARBro reference: `ArcFormats/MangaGamer/ArcMGPK.cs`, classes `Mgpk0Opener` and `MgpkOpener`
- GARbro tag: `MGPK0`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The signature spells `MGPK` and the version word behind it must be zero, because the reference's base class serves
every later version. The entry count sits at 8 and records begin at 0x0C with a 0x30-byte stride: a 0x20-byte
UTF-8 name field, the data offset, a word that belongs to the newer version, and the stored size at the end of the
record. The format is registered for the `pac` extension and every entry is checked against the file.

## The user key

Payload obfuscation here depends on a key that is *not* in the archive: the reference keeps a scheme table mapping
a game's title to a key array, reads the title from its own settings, and only consults it when some entry name
carries a `png` or `txt` extension. With no key configured it returns a plain archive whose payloads are read
verbatim, and with one it exclusive-ors each payload against the key and additionally runs the `txt` payloads
through an LZF routine.

The port mirrors the no-key case, which is the only one reachable without that external configuration: entries are
listed, the flagged ones are marked as needing a key, and extraction emits the stored bytes. The scheme table and
the LZF codec are not ported, so a configured key would be needed before either could be added meaningfully.

## Support

| Capability | Status |
| --- | --- |
| `MGPK` signature with the zero version word | Supported |
| `pac` extension requirement | Supported |
| Count validation | Supported |
| 0x30-byte records with UTF-8 names | Supported |
| Offset and placement validation | Supported |
| Encryption flagging for `png` and `txt` names | Supported as metadata |
| Stored extraction without a key | Supported, matching the reference |
| User key scheme and keyed decryption | Not ported |
| LZF decompression of `txt` payloads | Not ported |
| Archive creation | Unsupported |

Synthetic fixtures cover a two-entry archive, a flagged `png` entry that stays stored, a later version, a foreign
signature, and the extension requirement.
