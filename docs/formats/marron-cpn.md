# Marron CPN resource archive

## Reference and attribution

- GARBro reference: `Legacy/Marron/ArcCPN.cs`, class `DatOpener`
- GARBro tag: `DAT/CPN`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The `.dat` file holds only payloads; a sibling `.cpn` file holds a text index. The first byte of the
companion is an XOR key that obfuscates the rest, which decodes to CP932 text: a leading character,
the archive name, a `#`, and then entries of the form `#<name>$<offset>*<size>+`.

GARbro requires the stored name to match the archive's own file name before it reads any entry, and
it XOR-decrypts every payload with the same key.

## Support

| Capability | Status |
| --- | --- |
| Companion `.cpn` index | Supported |
| Keyed companion decryption | Supported |
| Regex entry records | Supported |
| Archive name validation | Supported |
| XOR-decrypted payloads | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the keyed index, entry parsing, payload decryption, archive name rejection,
and missing-companion rejection.
