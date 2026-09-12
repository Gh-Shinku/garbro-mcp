# Nekotaro NSC archive

## Reference and attribution

- GARBro reference: `Legacy/Nekotaro/ArcNSC.cs`, class `NscOpener`
- GARBro tag: `NSC`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`NSCF` archives store the first payload offset at 4 and a monotonic 32-bit offset table from
offset 8 to the end of file. Each entry spans from one offset to the next; a table value equal
to the file size ends the walk. Entries are named `<basename>#NNNN`.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Monotonic offset table | Supported |
| Generated entry names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
