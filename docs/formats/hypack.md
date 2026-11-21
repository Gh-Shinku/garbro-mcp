# Kogado HyPack

## Reference and attribution

- GARBro reference: `ArcFormats/Hypatia/ArcKogado.cs`, class `PakOpener`, and the Cocotte reader it calls, `ArcFormats/KogadoCocotte.cs`, class `CocotteEncoder`
- GARBro tag: `PAK/HyPack`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2014-2018 morkt
- License: MIT

The archive and Mariel implementations are independent TypeScript rewrites based on GARbro
behavior. The Cocotte reader is an independent walk of the algorithms the reference describes, as
recorded below.

## Structure

HyPack starts with `HyPack` and supports versions 0x100, 0x200, 0x300, and 0x301. Their index
records are respectively 0x20, 0x28, and 0x30 bytes. Each record combines a 0x15-byte CP932 basename
and three-byte extension, a data-relative offset, sizes, and—since version 0x200—a compression type.
Version 0x300 adds a per-entry CRC16 field and file timestamp.

The reader checks the decoded header of `.adp` entries for Hypatia ADP1 audio. It validates
the signature, sample count, rate, and channel count using the standalone reader's rules.
The probe reads a prefix or the first Cocotte block. Extraction preserves the stored resource format.

Compression type 1 is Mariel, an offset/count LZ stream controlled by MSB-first 32-bit flag words.
Type 3 inverts every stored byte. Type 2 is Cocotte, which the reference reads through
`ArcFormats/KogadoCocotte.cs`. A Cocotte stream is a run of blocks; every block opens with its packed
size and the size it unpacks to, and every payload is read back through a move-to-front order and the
inverse Burrows-Wheeler transform, whose two-byte index opens the places the order left. A payload as
long as the block's unpacked size plus those two bytes holds the transformed block as it stands; every
other payload is a carryless range coded stream read through the quasistatic frequency model of Michael
Schindler's qscoder. The model and the move-to-front order stand from block to block, and a stored block
restarts the model.

The header of `ArcFormats/KogadoCocotte.cs` states that the code it was ported from, of juicy.gt, is
licensed under the GNU GPL version 2, while GARbro and this project stand under the MIT licence.
`packages/formats/src/hypatia/cocotte.ts` is therefore an independent TypeScript walk of the algorithms
that file describes: the walk of the block loop and of the two transforms stands of the reference, and
the walk of the range coder and of the frequency model stands of the published qscoder of Michael
Schindler (`rangecod.c` and `qsmodel.c`). The reader was checked against streams written by that
published encoder itself.

## Support

| Capability | Status |
| --- | --- |
| Versions 0x100, 0x200, 0x300, and 0x301 | Supported |
| CP932 basename and extension fields | Supported |
| Raw entry extraction | Supported |
| Mariel LZ decompression | Supported |
| XOR-FF entry decoding | Supported |
| Cocotte decompression | Supported |
| Archive creation and CRC generation | Unsupported |

Synthetic fixtures cover every index version, fallback filenames, Mariel dictionary copies,
XOR-FF, and the three kinds of Cocotte block: one the coder shortened, a stream of two blocks whose
model and move-to-front order stand across the boundary, and one stored as it stands. The Cocotte
streams of the tests that anchor compatibility were written by the published qscoder encoder rather than
by the writer the tests also carry, so that the reader answers to the format and not only to its own
writer. No real game data is used, following the current migration policy.
