# Hardware Acceleration

MosaicTV transcodes every channel to a consistent format so streams are
seamless. That encoding can run on the **CPU** (works everywhere, default) or
an **NVIDIA GPU** (much lower CPU load).

| | Encoder | Decoder |
| - | ------- | ------- |
| **CPU** (default) | libx264 | CPU |
| **NVIDIA** | h264_nvenc | NVDEC for supported codecs, CPU otherwise |

Support is detected at runtime: if NVENC isn't available, MosaicTV logs a
warning and uses the CPU — a missing GPU never breaks the stream. GPU
*decoding* (NVDEC) is probed per codec, so files the card can't decode simply
decode on the CPU.

> **Intel QuickSync / AMD (VAAPI)** are not supported yet — CPU encoding works
> fine on those boxes. If you want QSV/VAAPI support, open an issue!

## Do I need a GPU?

A modern CPU handles a few 720p30 channels fine (`libx264 veryfast`). Consider
a GPU when you want several channels streaming at once, 1080p output, or the
server also does other heavy work. Streams are only encoded **while someone is
watching** — idle channels cost nothing.

---

## NVIDIA setup

### Unraid

1. Install the **Nvidia-Driver** plugin (Community Apps) and reboot as prompted.
2. Edit the MosaicTV container:
   - **Extra Parameters**: add `--runtime=nvidia`
   - **NVIDIA GPUs** (`NVIDIA_VISIBLE_DEVICES`): `all`, or one GPU's UUID from
     `nvidia-smi -L` to pin a specific card
   - **NVIDIA Capabilities** (`NVIDIA_DRIVER_CAPABILITIES`): `all`
3. Apply. Check **Logs** in MosaicTV — streams should mention `h264_nvenc`.

### docker run

Requires the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
on the host:

```bash
docker run -d ... \
  --gpus all \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=all \
  ghcr.io/tronvondoom/mosaictv:latest
```

### Docker Compose

Uncomment the NVIDIA lines in `docker-compose.yml`:

```yaml
    runtime: nvidia
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=all
```

---

## Encoding profiles

**Settings → Encoding profiles** — create profiles and assign them per channel
(channel **General** tab). Channels without one use the built-in default
(1280×720, 30 fps).

| Setting | What it does |
| ------- | ------------ |
| **Resolution / FPS** | Output size and frame rate for the whole channel |
| **Quality** | Bitrate/CRF ladder (scaled by resolution) |
| **Hardware** | `auto` (GPU if present), `nvidia` (warns + falls back if missing), `cpu` (force libx264) |
| **Preset** | Encoder speed/quality trade-off (`veryfast`… for x264, `p1`–`p7` for nvenc) |
| **Video bitrate / buffer** | Explicit rate control override |
| **Scaling mode / deinterlace** | How source video is fitted; deinterlacing for older content |
| **Audio bitrate / channels** | AAC output settings |
| **Normalize loudness** | Even out volume across different sources |
| **Threads** | CPU thread cap for the encoder |

A practical split: a "HD" profile (1080p, `auto`) for your main channels and a
"Light" profile (720p, `cpu`, capped threads) for background/filler-heavy ones.
