# Crowd hi-color bitmap

Reference: `GARbro/ArcFormats/Crowd/ImageCWL.cs`, class `CwdFormat`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/crowd/cwl-image.ts` (`crowdCwdImageDescriptor`, `crowdCwdImageFormat`, id
`crowd-cwd-image`, `readCwdLayout`, `readCwdPixels`).

The signature word the reference declares is `0x20647763`, the letters `cwd `, but the reference checks more
than that: the header has to begin with the letters `cwd format  - version 1.00 -`, which is what the port
checks as well. The header is fifty six bytes:

| offset | what it holds |
| --- | --- |
| `0x00` | the letters above |
| `0x2C` | the width, behind a count the byte at the end of the header is raised by |
| `0x30` | the height, behind the same count |
| `0x34` | the byte the count is raised by, which stands at `0x259A` plus that byte |

Behind the header stand the pixels, two bytes to the pixel and the top row first. The reference reports the
depth as fifteen bits and hands the picture out as `Bgr555`; the port reports the depth of the bitmap it writes,
sixteen bits, and writes it with the masks of a high colour bitmap — red in the five highest bits of each pixel
word, then green, then blue. The picture is written top down, and the reference's write path throws
`NotImplementedException`, so this is a read only format.

A file whose header is not all there, whose letters are not the ones above, or whose measurements come out at
nothing once the count is put on them — which is what a stored measurement of the count taken below nothing
looks like, since the measurements are long words — is turned away. A picture the file is short of is refused
where the reference throws, and a picture whose pixels would take more than 256 megabytes is refused as well.

The tests cover the letters of the header and the decline of a file one letter of them away, the declines of a
header that is not all there and of a stored measurement that comes out at nothing, the count raised by the byte
at the end of the header, the measurements and the depth of the picture as they are reported, the pixels behind
the header, the masks of the high colour bitmap and the rows it is written with, and the refusal of a picture
the file is short of, as well as a picture too large to hold.
