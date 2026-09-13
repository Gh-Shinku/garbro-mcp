# ShiinaRio engine resource archive (WAR/1.0)

## Reference and attribution

- GARbro reference: `ArcFormats/ShiinaRio/ArcWARC1.0.cs`, classes `War0Opener` and `Ylz16Reader`
- GARBro tag: `WAR/1.0`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive opens with the eight byte string `WARC 1.0` and a 32-bit index offset. The index is masked with a two
byte pattern before its records are read, and a payload that opens with `Ylz` holds an exclusive-ored LZ stream.

## Layout

```
[0x00] "WARC 1.0"
[0x08] u32 index offset
[index offset] records of 0x18 bytes: [name 0x10][u32 payload offset][u32 stored size]
```

The index is read as a block of at most 0xC000 bytes from its offset to the end of the file, so an archive
carries at most 2048 records; the reference reads exactly that much and derives the record count from the
resulting length. Every second byte of the block is exclusive-ored, with `0xFE` on even and `0xE5` on odd
positions, which means a block of odd length cannot be read. Names are CP932, NUL terminated inside their
sixteen byte window, and are kept verbatim. An entry whose payload leaves the file declines the archive.

Payloads follow the index in real archives, because the record area runs to the end of the file.

## Packed payloads

A payload of at least eight bytes that opens with `Ylz` carries its unpacked size as a 32-bit word at offset four
and an exclusive-ored stream behind that. Every byte of the stream is exclusive-ored with `0xE6` before decoding.

`Ylz16Reader` reads control words and payload bytes from one cursor. A control word is sixteen bits wide and is
consumed least significant bit first; the decoder reads one control bit before it loads its first word, and that
first bit comes from an empty control word, so it never comes from the stream: the first stored bit is the first
flag. A literal flag yields one byte. Otherwise two more control bits pick a copy:

| form | selection | meaning |
| --- | --- | --- |
| short | `0` | copy `2 + two control bits` bytes from a one byte distance of `byte + 0x100` counted backwards |
| long | `1` | copy `2 + low three bits of the second distance byte` bytes, or `byte + 9` when those bits are zero and the following byte is not |
| end | `1`, zero count | a long form whose extended count byte is zero ends the stream, leaving the rest of the output zeroed |

A long form carries its distance in thirteen bits: `byte | ((byte & 0xF8) << 5) - 0x2000`, which expresses
distances from one to 0x2000. Copies run byte by byte, so they can overlap the output they just produced.

## Listing and extraction

Entries are listed with their stored size, unless the payload opens with the packing marker, in which case the
entry is marked as compressed and the declared unpacked size is listed. GARbro makes that decision while opening
an entry, so its listing always shows the stored size; this port probes the payload header at list time so that
the listed size and the extracted bytes agree.

Extraction decodes packed payloads and returns stored payloads unchanged. A packed stream that runs out of input
or would copy from before the start of the output raises an error rather than falling back to the stored bytes,
matching the reference, which lets its array accesses throw.

## Deviations from GARbro

- The packed probe happens at list time, as described above.
- GARbro reads the index through a view that returns a short buffer at the end of the file; this port reads the
  same amount explicitly and declines an index that is not a whole number of byte pairs.

## Tests

`tests/formats/shiina-rio-warc.test.ts` encodes streams with the same interleaving the decoder uses and covers
stored and packed payloads, short and extended long copies, the end marker with its trailing zeroes, a wrong
signature, an index outside the file, an index block of odd length and an archive without records.
