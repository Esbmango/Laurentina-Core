"""Offline speech worker with bounded model caches, run from .voice-venv."""
import base64
import contextlib
import io
import json
import math
import os
import sys
import wave
from pathlib import Path
from collections import OrderedDict


_PIPER_VOICES = OrderedDict()
_WHISPER_MODELS = OrderedDict()


def _model_key(path, names=()):
    path = Path(path).resolve()
    paths = [path / name for name in names] if names else [path, Path(str(path) + ".json")]
    return (str(path), tuple((p.stat().st_size, p.stat().st_mtime_ns) for p in paths))


def _cached(cache, key, load, maximum):
    if key in cache:
        cache.move_to_end(key)
        return cache[key]
    # Changed files/policy must not keep an obsolete copy of the same model.
    for old in list(cache):
        if old[0] == key[0]:
            del cache[old]
    # Evict before allocating a replacement to avoid a transient N+1 models.
    while len(cache) >= maximum:
        cache.popitem(last=False)
    result = load()
    cache[key] = result
    while len(cache) > maximum:
        cache.popitem(last=False)
    return result


def _load_piper(model_path, preset):
    from piper import PiperConfig, PiperVoice
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.intra_op_num_threads = max(1, min(4, os.cpu_count() or 1))
    options.inter_op_num_threads = 1
    if preset == "low_memory":
        options.enable_cpu_mem_arena = False
        options.enable_mem_pattern = False
    return PiperVoice(config=PiperConfig.from_dict(json.loads(Path(str(model_path) + ".json").read_text(encoding="utf-8"))),
        session=ort.InferenceSession(str(model_path), sess_options=options, providers=["CPUExecutionProvider"]))


def _piper_model(model_path, preset="balanced"):
    model_path = Path(model_path)
    if not model_path.is_file() or not Path(str(model_path) + ".json").is_file():
        raise VoiceError("本地中英声音模型文件不完整。")
    if preset not in ("balanced", "low_memory"):
        raise VoiceError("资源模式无效。")
    return _cached(_PIPER_VOICES, (*_model_key(model_path), preset),
                   lambda: _load_piper(model_path, preset), maximum=2)


def _whisper_model(model_path):
    from faster_whisper import WhisperModel
    model_path = Path(model_path)
    if not all((model_path / name).is_file() for name in ("model.bin", "config.json", "tokenizer.json")):
        raise VoiceError("本地语音识别模型文件不完整。")
    return _cached(_WHISPER_MODELS, _model_key(model_path, ("model.bin", "config.json", "tokenizer.json")),
        lambda: WhisperModel(str(model_path), device="cpu", compute_type="int8", cpu_threads=max(1, min(4, os.cpu_count() or 1)),
                             local_files_only=True), maximum=1)


def prepare(payload):
    if payload.get("engine") == "piper":
        paths = payload.get("model_paths")
        if not isinstance(paths, list) or not 1 <= len(paths) <= 2 or any(not isinstance(path, str) for path in paths):
            raise VoiceError("声音预热参数无效。")
        for path in paths:
            _piper_model(path, payload.get("resource_preset", "balanced"))
    elif payload.get("engine") == "whisper":
        _whisper_model(payload["model_path"])
    else:
        raise VoiceError("声音预热参数无效。")
    return {"ok": True, "ready": True}


class VoiceError(RuntimeError):
    pass


def transcribe(payload):
    import av
    import numpy as np
    audio_path, model_path = Path(payload["audio_path"]), Path(payload["model_path"])
    if not audio_path.is_file() or audio_path.stat().st_size > 8 * 1024 * 1024:
        raise VoiceError("录音文件不存在或超过大小限制。")
    if not all((model_path / name).is_file() for name in ("model.bin", "config.json", "tokenizer.json")):
        raise VoiceError("本地语音识别模型文件不完整。")
    seconds, audio_frames, sample_count = 0.0, 0, 0
    resampler = av.AudioResampler(format="fltp", layout="mono", rate=16000)
    parts = []
    def collect(frames):
        nonlocal sample_count
        for converted in frames:
            array = np.asarray(converted.to_ndarray(), dtype=np.float32).reshape(-1)
            sample_count += array.size
            if sample_count > 60 * 16000:
                raise VoiceError("每次录音最长一分钟，请缩短后重试。")
            if not np.all(np.isfinite(array)):
                raise VoiceError("录音包含无效采样数据。")
            parts.append(array.copy())
    # Decode and normalize once. Passing a float array avoids faster-whisper's
    # older decode_audio(av.open(metadata_errors=...)) path on current PyAV.
    with av.open(str(audio_path)) as container:
        if not container.streams.audio:
            raise VoiceError("录音文件没有音轨。")
        for frame in container.decode(audio=0):
            sample_rate = frame.sample_rate
            if not sample_rate or sample_rate > 192000:
                raise VoiceError("录音采样率不受支持。")
            seconds += frame.samples / sample_rate
            audio_frames += frame.samples
            if seconds > 60.1:
                raise VoiceError("每次录音最长一分钟，请缩短后重试。")
            collect(resampler.resample(frame))
        collect(resampler.resample(None))
    if not audio_frames or seconds < 0.1:
        raise VoiceError("录音过短或没有可识别音频。")
    if not parts or not sample_count:
        raise VoiceError("录音没有可识别音频。")
    audio = np.ascontiguousarray(np.concatenate(parts), dtype=np.float32)
    model = _whisper_model(model_path)
    beam = payload.get("beam_size", 3)
    if type(beam) is not int or beam not in (1, 3):
        raise VoiceError("语音识别参数无效。")
    segments, _info = model.transcribe(audio, beam_size=beam, language=None, vad_filter=False, condition_on_previous_text=False,
                                      no_speech_threshold=0.6)
    text = "".join(segment.text for segment in segments).strip()
    return {"ok": True, "text": text, "duration_seconds": round(seconds, 3)}


def speak(payload):
    chunks = payload.get("chunks")
    if not isinstance(chunks, list) or not chunks or any(not isinstance(c, dict) or not isinstance(c.get("text"), str) for c in chunks):
        raise VoiceError("朗读文本格式无效。")
    if not 1 <= sum(len(c["text"]) for c in chunks) <= 2000:
        raise VoiceError("朗读文本长度应为 1–2000 个字符。")
    rate = payload.get("speech_rate", 1.0)
    if type(rate) not in (int, float) or not math.isfinite(rate) or not 0.7 <= rate <= 1.4:
        raise VoiceError("朗读速度应在 0.7–1.4 倍之间。")
    syn_config = None
    if rate != 1:
        from piper import SynthesisConfig
        syn_config = SynthesisConfig(length_scale=1.0 / rate)
    audio_parts, parameters = [], None
    for chunk in chunks:
        model_path = Path(chunk["model_path"])
        voice = _piper_model(model_path, payload.get("resource_preset", "balanced"))
        part = io.BytesIO()
        with wave.open(part, "wb") as wav_file:
            if syn_config is None:
                voice.synthesize_wav(chunk["text"].strip(), wav_file)
            else:
                voice.synthesize_wav(chunk["text"].strip(), wav_file, syn_config=syn_config)
        with wave.open(io.BytesIO(part.getvalue()), "rb") as source:
            current = (source.getnchannels(), source.getsampwidth(), source.getframerate())
            if parameters is not None and current != parameters:
                raise VoiceError("中英声音的采样参数不一致，请分别朗读。")
            parameters = current
            audio_parts.append(source.readframes(source.getnframes()))
        if sum(len(a) for a in audio_parts) > 16 * 1024 * 1024:
            raise VoiceError("语音结果过大，请分段朗读。")
    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(parameters[0])
        wav_file.setsampwidth(parameters[1])
        wav_file.setframerate(parameters[2])
        for audio in audio_parts:
            wav_file.writeframes(audio)
    raw = output.getvalue()
    if len(raw) > 16 * 1024 * 1024:
        raise VoiceError("语音结果过大，请分段朗读。")
    return {"ok": True, "audio_base64": base64.b64encode(raw).decode("ascii"), "mime_type": "audio/wav"}


def handle(payload):
    try:
        if not isinstance(payload, dict):
            raise VoiceError("语音请求格式无效。")
        # Keep library banners/progress away from the machine-readable stdout.
        with contextlib.redirect_stdout(sys.stderr):
            if payload.get("action") == "transcribe":
                result = transcribe(payload)
            elif payload.get("action") == "speak":
                result = speak(payload)
            elif payload.get("action") == "prepare":
                result = prepare(payload)
            else:
                raise VoiceError("语音操作不受支持。")
    except VoiceError as exc:
        result = {"ok": False, "error": str(exc)}
    except Exception:
        result = {"ok": False, "error": "本地语音引擎无法处理此内容，请检查录音、模型和运行环境。"}
    if isinstance(payload, dict) and "request_id" in payload:
        result["request_id"] = payload["request_id"]
    return result


def main():
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_DATASETS_OFFLINE="1", TOKENIZERS_PARALLELISM="false")
    limit = 12 * 1024 * 1024
    if "--serve" in sys.argv:
        # Single-threaded input avoids native DLL initialization deadlocks on
        # Windows. Core owns a kill-on-close job for abrupt parent termination;
        # ordinary EOF exits here as well, releasing cached models.
        while True:
            line = sys.stdin.buffer.readline(limit + 1)
            if not line:
                return
            if len(line) > limit or not line.endswith(b"\n"):
                return
            try:
                payload = json.loads(line)
            except (ValueError, UnicodeDecodeError):
                return
            print(json.dumps(handle(payload), ensure_ascii=False), flush=True)
    else:
        try:
            payload = json.loads(sys.stdin.buffer.read(limit + 1))
        except (ValueError, UnicodeDecodeError):
            payload = None
        print(json.dumps(handle(payload), ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
