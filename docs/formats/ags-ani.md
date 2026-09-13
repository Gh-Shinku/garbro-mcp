# Anime Game System ANI animation resources

## Reference and attribution

- GARBro reference: `ArcFormats/AnimeGameSystem/ArcANI.cs`, class `AniOpener`
- GARBro tag: `ANI`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Layout

The format only applies to `.ani` names. The first word is both the payload offset and the frame table size: the table
holds one 32-bit offset per frame after the first, so

```text
frame count = first word / 4
first payload offset = first word
```

which means the first word has to be at least four, word-aligned, and inside the file; the reference also refuses files
larger than a signed 32-bit length and more than 10000 frames. Every table offset has to point at or after the first
payload, and each distinct offset starts with a frame type byte below 0x20.

## Listing

Frames are walked in table order:

| Frame type | Effect |
| --- | --- |
| 1 | Skipped, not listed |
| 0, 0x0A | Listed, and starts a new key frame group |
| Other | Listed, masked to its low nibble |

Listed frames are named after their table index with four digits and are recorded as images together with the frame
type, key frame and frame index the image layer needs. A key frame group is tracked by the number of listed frames, so
a frame that starts a group is its own key frame. The archive is rejected when nothing is listed.

**Sizes are not in the table.** Listed frames are sorted by offset, and each one stores up to the next *different*
offset — or to the end of the file. Because skipped frames are never listed, a run of skipped frames at the end of a
group is absorbed into the previous listed frame's extent, exactly as the reference computes it. Frames that share an
offset also share that extent.

## Extraction

GARbro does not override `OpenEntry` for this format, so entries are extracted as stored frames. The reference decodes
them through the separate `CG` image format, including its key frame chain; that image layer is out of scope here, and
the frame metadata needed to implement it later is part of every entry.

## Support

| Capability | Status |
| --- | --- |
| `.ani` extension gate | Supported |
| Frame table derived from the first offset | Supported |
| Frame offsets and table bounds | Supported |
| Frame type byte per distinct offset | Supported |
| Skipped frames and low nibble frame types | Supported |
| Key frame tracking and frame metadata | Supported |
| Offset-ordered size assignment | Supported |
| Raw frame extraction | Supported |
| CG image decoding and key frame chaining | Unsupported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover a three-frame archive with a skipped frame, key frame groups, a last frame that reaches the end
of the file, two frames sharing one payload, a name without the `.ani` extension, a misaligned first offset, a first
offset inside the header, a first offset past the end of the file, a table offset before the payload area, a frame type
at or above 0x20, an archive whose frames are all skipped, too many frames, and a file too small for its header.
