# Will Co. WIP multi-frame image

## Reference and attribution

- GARBro reference: `ArcFormats/Will/ArcWIP.cs`, class `WipOpener`
- GARBro tag: `WIP/MULTI`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `WIPF` file starts with a 0x20-byte header: the frame count is a 16-bit word at 0x04 and the bit depth a 16-bit word
at 0x06. Frame records begin at 0x08 and are 0x18 bytes each; the last word of a record is its stored frame size, and
frames are laid out back to back after the records.

Frames are named after the archive base name with a four-digit index and a `.wip` extension, and every frame is reported
as an image. The reference performs the placement check against each frame's declared size **before** adding the
0x400-byte palette block that 8-bit images carry, while the running offset accumulates the padded size. The port
reproduces that ordering, so the extracted length of an 8-bit frame covers the palette block as well.

## Extraction

Each frame is extracted as the archive's 0x20-byte header with the frame count patched to one and the frame's own 0x18
index record copied into it, followed by the stored bytes. This mirrors the reference's `PrefixStream` wrapper, and the
declared extracted size therefore equals the emitted length exactly.

## Support

| Capability | Status |
| --- | --- |
| `WIPF` signature and `.wip` extension | Supported |
| 0x18-byte frame records | Supported |
| Index-derived frame names | Supported |
| Back-to-back frame offsets | Supported |
| 8-bit palette padding | Supported |
| Synthesized frame headers | Supported |
| Prefix-wrapped extraction | Supported |
| Image decoding | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover frame listing and extraction, the 8-bit palette padding, a foreign signature, an out-of-range
frame and a truncated index. The frame header is rebuilt from the source at extraction time instead of being cached in
entry metadata.
