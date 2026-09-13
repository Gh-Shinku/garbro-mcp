# QLIE engine ABMP7 resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Qlie/ArcABMP.cs`, classes `Abmp7Opener` and `AbmpReader`
- GARbro tag: `ABMP7`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

This version shares its parent's extraction but not its index. The signature spells `ABMP` and the word behind it
must carry the digit `7`, which is how the two are told apart despite their similar names. There is no tag table:
the word at 0x0C gives the first frame's size and that frame follows it, and every later frame repeats the shape
of a size word and a payload.

A zero size ends the list, and a frame whose span leaves the file breaks the walk rather than rejecting the
archive, so the entries found so far stand. The first frame is named with a `.dat` extension and no type, while
later frames are named without an extension and classified as images.

Payloads follow the shared extraction path, so a frame beginning with the pack marker is expanded by that codec
and anything else is emitted verbatim.

## Support

| Capability | Status |
| --- | --- |
| `ABMP` signature with the digit `7` | Supported |
| First frame behind the size word at 0x0C | Supported |
| Later frames behind their own size words | Supported |
| Zero size ending the list | Supported |
| Frame span breaking rather than rejecting | Supported |
| Generated names for both frame shapes | Supported |
| Pack codec expansion with the stored fallback | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover two frames and a head whose version word lacks the digit.
