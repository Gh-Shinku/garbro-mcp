# Leaf audio format (Ogg/Vorbis)

Reference: `GARbro/ArcFormats/Leaf/AudioG.cs`, classes `GAudio` and `GStream`, with the mark of the pages from
`ArcFormats/Crc32.cs`, class `Crc32Normal`. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT
License.

Implementation: `packages/formats/src/leaf/g-audio.ts` (`leafGAudioDescriptor`, `leafGAudioFormat`, id
`leaf-g-audio`, `readGAudioLayout`, `decodeG`), with the mark of the normal polynomial added to
`packages/codecs/src/crc32.ts` (`crc32Normal`).

The reference registers no word of its own, only the name `g`.

## The head and the pages

A sound of this engine is not a sound of the Ogg kind as it stands and not a wave file either: its first four
bytes are neither `OggS` nor `RIFF`, the byte at four is nought, the byte behind it is two and the eight bytes
behind those stand as nought. What stands behind that is the head of the first page of the sound itself — the
pages stand from the beginning of the file — and the sound is given page by page as the engine wrote them.

## The walk of the pages

A page of an Ogg sound is twenty seven bytes, the count of its segments, its table of them and its places. The
walk of the pages puts the word back:

| the byte that names the place | what the walk does with the page |
| ----------------------------- | -------------------------------- |
| 1, the first place | the word `vorbis` stands behind the byte, the first entry of the table grows by five and the walk moves to the second place |
| any other byte | the page stands as it was written, the two bytes behind the byte as well |

Every page the walk gives stands with the word `OggS` over its first four bytes — the engine did not write it —
and with its own mark written afresh: the mark of a page is the CRC of the normal polynomial over the whole of
it, its own four bytes standing as nought while the mark is worked out. What is handed out is the sound of the
Ogg kind the pages make up.

## Deviations from the reference

- The reference hands the sound to its own decoder of the Ogg kind; the port hands out the sound as it stands,
  since this project holds no decoder for it.
- A file of fewer than twenty eight bytes, a file that begins with `OggS` or `RIFF`, a file whose byte at four
  is not nought, whose byte at five is not two or whose eight bytes behind those do not stand as nought is
  turned away; the reference turns the same files away, and the name `g` of the file is what its own catalog
  holds it by.
- A place of the second place of the sound that reaches out of the sound is read as far as it stands, which is
  what the reference's own read of a stream does; a page that is cut short is given as far as it stands.

## Tests

four pages of a sound with the words of their codecs put back, the marks of the four pages, a page whose byte
names no place of the sound, a page that is cut short, the sound handed out as a sound of the Ogg kind, a file
whose name is not `g` and a file that does not hold a sound. The marks of the four pages are worked out by
hand: 0x5AFD9B39, 0xCF303F23, 0xCBC760CD and 0x6169105C, and `crc32Normal` itself is held to the two check
vectors of the normal polynomial in `tests/unit/codecs.test.ts`.
