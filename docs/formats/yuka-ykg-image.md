# Yuka engine image format

Reference: `GARbro/ArcFormats/Yuka/ImageYKG.cs`, class `YkgFormat`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/yuka/ykg-image.ts` (`yukaYkgImageDescriptor`, `yukaYkgImageFormat`, id
`yuka-ykg-image`, `readYkgLayout`).

The file begins with the word `YKG0` and a head of sixty four bytes; the four bytes behind the tag word must
be `00` and two clear bytes. The offset of the wrapped picture stands at `0x28` — or, when that is nothing,
at eight — and its size at `0x2C`, a size of nothing meaning the rest of the file. An offset inside the head
is refused, as is a region that reaches past the file.

The four bytes at the offset name the picture, and the reference reads it through its own bitmap or portable
network graphic reader, carrying the measurements and the offsets it finds back onto the wrapper:

| tag | picture |
| --- | --- |
| `BM` | a Windows bitmap |
| `89 50 4E 47` | a portable network graphic |
| `89 47 4E 50` | a portable network graphic whose signature has been turned around: the body from the fifth byte on is read behind the standard four byte prefix |

The port hands the wrapped picture out as it stands rather than decoding and re-encoding it, which is what the
other ports that wrap a portable network graphic do as well: a bitmap and a portable network graphic are
copied byte for byte, and an obfuscated one has its four byte prefix put back. The entry is named after the
wrapped kind, so the extraction carries the extension the payload deserves, and a truncated picture is
refused where the wrapper's own reader would have thrown.

The tests cover each of the three tags, the version bytes, an offset inside the head, a picture the wrapper's
readers do not know, a bitmap that is not all there, the offset at eight, the size of nothing standing for
the rest of the file, the measurements of a wrapped bitmap and of a wrapped portable network graphic, the
bytes handed out for a bitmap and for a portable network graphic, the signature put back in front of an
obfuscated picture, a declared size that leaves what stands behind it, and a picture that does not lie where
the head says.
