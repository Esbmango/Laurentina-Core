"""Stream user audio into a bounded, inert PCM WAV using the existing CPU runtime."""
import json
from pathlib import Path
import stat
import sys
import wave


def normalize(source, target):
    import av
    import numpy as np

    source, target = Path(source), Path(target)
    info = source.lstat()
    if (not source.is_absolute() or not target.is_absolute() or source.is_symlink()
            or not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= 20 * 1024**2
            or source.suffix.lower() not in {'.wav', '.mp3', '.flac', '.ogg'}
            or target.exists() or target.is_symlink() or target.parent.is_symlink()):
        raise ValueError('录音文件或目标路径无效。')
    frames_written, seconds, created = 0, 0.0, False
    resampler = av.AudioResampler(format='s16', layout='mono', rate=24000)
    try:
        with target.open('xb') as output:
            created = True
            with wave.open(output, 'wb') as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(24000)

                def collect(frames):
                    nonlocal frames_written
                    for frame in frames:
                        audio = frame.to_ndarray().reshape(-1)
                        frames_written += audio.size
                        if frames_written > 60 * 24000:
                            raise ValueError('录音最长 60 秒。')
                        wav.writeframesraw(audio.astype('<i2', copy=False).tobytes())

                with av.open(str(source)) as container:
                    if not container.streams.audio or container.streams.video:
                        raise ValueError('文件需要包含音频。')
                    for frame in container.decode(audio=0):
                        if (not 8000 <= frame.sample_rate <= 192000
                                or not 1 <= len(frame.layout.channels) <= 8
                                or not np.isfinite(frame.to_ndarray()).all()):
                            raise ValueError('录音采样数据无效。')
                        seconds += frame.samples / frame.sample_rate
                        if seconds > 60.01:
                            raise ValueError('录音最长 60 秒。')
                        collect(resampler.resample(frame))
                    collect(resampler.resample(None))
                if frames_written < .15 * 24000:
                    raise ValueError('录音至少需要 0.15 秒。')
        return {'duration': frames_written / 24000, 'sample_rate': 24000}
    except Exception:
        if created:
            target.unlink(missing_ok=True)
        raise


if __name__ == '__main__':
    try:
        source, target = map(Path, sys.argv[1:3])
        print(json.dumps(normalize(source, target), ensure_ascii=False))
    except Exception:
        print(json.dumps({'error': '录音无法读取，请使用 0.15–60 秒的 WAV、MP3、FLAC 或 OGG。'}, ensure_ascii=False))
        sys.exit(1)