# Cat System CsPack2 resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/CatSystem/ArcDAT.cs`, class `DatOpener` and `CsNameDecryptor`
- GARBro tag: `DAT/CSPACK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `CsPack2` archive stores the data offset at 8 and 24-byte records from 12; the record count is
derived from the index size. The first twenty bytes of a record are base-40 digits, six per 32-bit
word, that fill a 30-character name field: the base name is the field up to a NUL, and when character
0x10 is set the name also carries a dot and three more characters.

Sizes are chained: GARbro XORs the record's first, second, and last 32-bit words to obtain the end of
that entry, and every entry starts where the previous one ended. GARbro's alphabet holds 38 symbols
while the digits are taken modulo 40, so the port rejects records that would index past it instead of
failing at run time as the reference does.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Derived record count | Supported |
| Base-40 name decoding | Supported |
| Optional three-character extension | Supported |
| XOR-chained entry sizes | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Digits outside the reference alphabet | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover the name decoding with and without an extension, the size chain, signature
rejection, and chain rejection.
