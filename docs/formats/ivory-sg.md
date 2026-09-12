# Ivory SG multi-frame image

## Reference and attribution

- GARBro reference: `ArcFormats/Ivory/ArcSG.cs`, class `SgOpener`
- GARBro tag: `SG/cOBJ`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`SG` files start with the ASCII signature `fSGX`. From offset 8 the file is a chain of
`cOBJ` chunks: a 4-byte tag, a 32-bit chunk size that covers the whole chunk, eight bytes of
unknown data, and an optional `fSG ` image object. Chunks whose payload does not start with
`fSG ` are skipped, and a zero chunk size ends the walk.

For every `fSG ` object GARbro exposes an entry covering the object start and the 32-bit size stored
at object offset 4, so the listed stream still contains the `fSG ` structure header. Entries are
named `<basename>#0`, `<basename>#1`, ... in chunk order.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| COBJ chunk walk | Supported |
| FSG object listing | Supported |
| Generated frame names | Supported |
| Entry listing and extraction | Supported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
