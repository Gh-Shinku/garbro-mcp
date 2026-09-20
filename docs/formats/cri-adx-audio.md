# CRI MiddleWare ADPCM audio (`ADX`)

Reference: GARbro `ArcFormats/Cri/AudioADX.cs`, classes `AdxAudio`, `AdxInput` and `AdxReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

| place | word |
| --- | --- |
| 2 | `0x0080` (u16, big endian) |

| place | word |
| --- | --- |

```
adjust = (scale0 * previous + scale1 * before) >> 12
sample = clamp16(nibble * scale + adjust)
```

```
root = sqrt(2)
x = root - cos(2 * pi * lowest / rate)
y = root - 1
z = (x - sqrt((x + y) * (x - y))) / y
scale0 = floor(z * 8192)
scale1 = floor(z * z * -4096)
```

## Deviations from the reference

  such a sound away.
  them.
  of them.

## Verification

stands them.
