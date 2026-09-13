# AGS32i engine encrypted wave audio

Reference: `GARbro/Legacy/Ags32i/AudioAGS.cs`, class `AgsAudio`, with the cipher from
`GARbro/Legacy/Ags32i/ImageGSS.cs`, class `Ags32Transform`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/ags32i/wav-audio.ts` (`agsAudioDescriptor`, `agsAudioFormat`,
id `ags32i-wav-audio`).

A standalone audio resource: the whole file is a wave file encrypted with a four-byte block cipher.
The reference declares the signature list `{ 0x66424047, 0 }`, because those first four bytes are the
**encrypted `RIFF` tag**: the key is recovered as `key = storedWord ^ 0x46464952`, and a key of zero
declines. It then decrypts the stream, requires `WAVE` at offset eight and hands everything to the
wave reader, so extraction is the whole decrypted file.

## The `Ags32Transform` cipher

The keystream is derived from the block index, not from the plaintext:

```text
for byte at absolute position p:
    block = p / 4
    word  = RotL32(key + block / 31, block % 31)
    mask  = (word >> ((p % 4) * 8)) & 0xFF
    output[p] = input[p] XOR mask
```

So the cipher is a keystream, not a chain: encryption and decryption are the same operation, and the
length is preserved. The rotation period of 31 blocks (124 bytes) is what makes it more than a fixed
mask.

## Deviations

* The reference's `TransformFinalBlock` uses a buggy index expression (it increments the loop counter
  inside both the shift and the input index) that garbles up to three trailing bytes when the stream
  length is not a multiple of four. The port keeps the plain per-byte formula for every byte instead
  of reproducing that corruption.
* Decoding the wave payload and archive creation are out of scope.
