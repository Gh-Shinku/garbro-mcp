# Force PAQ archive

## Reference and attribution

- GARBro reference: `Legacy/Force/ArcPAQ.cs`, class `PaqOpener`
- GARBro tag: `PAQ/FORCE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`PAQ` files are detected by extension. A 32-bit entry count sits at offset 0 and the record
table starts at offset 4 with 8-byte records; GARbro reads the size from the second word of
each record, so the payload area begins right after the table at `4 + count * 8`. Entries are
named `<basename>#NNNN`.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| 8-byte size records | Supported |
| Generated entry names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
