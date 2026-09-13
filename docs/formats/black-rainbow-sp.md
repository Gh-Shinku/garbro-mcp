# BlackRainbow script archive

## Reference and attribution

- GARBro reference: `ArcFormats/BlackRainbow/ArcSPPAK.cs`, classes `SpPakOpener` and `SpArchive`
- GARbro tag: `PAK/SP`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Only two signatures are registered, each naming the byte its payloads are keyed with — one for Kannagi and one
for From M — so the port refuses any other head word rather than guessing at a key. The entry count sits at 4 and
the offset table begins at 8, with the payloads directly behind it.

Records hold a single offset relative to that data start, and nothing else: sizes are the gaps between
consecutive offsets and the last entry runs to the end of the file. The reference performs no placement check on
those derived spans, while the port validates them. Entries carry generated names built from the archive's own
name and a four-digit index, since the format stores none.

Extraction applies the signature's key byte to every payload byte and then rotates the result right by two bits;
the inverse rotation is exported so fixtures can construct stored payloads.

## Support

| Capability | Status |
| --- | --- |
| Both signatures with their key bytes | Supported |
| Entry count validation | Supported |
| Offset table with derived sizes | Supported |
| Entries running to the end of the file | Supported |
| Generated four-digit names | Supported |
| Offset bound and placement validation | Supported |
| Keyed payload extraction with its rotation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover both keys, an unknown signature, an empty count, and an offset that leaves the file.
