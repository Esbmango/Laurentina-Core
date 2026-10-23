"""Speech-only text cleanup. Never apply to stored chat or reference transcripts."""
import re

_KEYCAP = re.compile(r"([0-9#*])\ufe0f?\u20e3")
_DECORATION = re.compile("[\U0001f000-\U0001faff\u2600-\u27bf]")
_INVISIBLE = re.compile("[\u200d\ufe00-\ufe0f\U000e0020-\U000e007f\U000e0100-\U000e01ef]")


def strip_spoken_symbols(text):
    text = _KEYCAP.sub(r"\1", text)
    text = _DECORATION.sub(" ", _INVISIBLE.sub("", text))
    return re.sub(r"[ \t]+", " ", text).strip()


def target_speech_language(text):
    """Target text controls pronunciation; reference language never selects it."""
    if re.search(r"[\u3040-\u30ff\uff66-\uff9d]", text):
        return "Japanese"
    if re.search(r"[\u3400-\u9fff]", text):
        return "Chinese"
    if re.search(r"[A-Za-z\u00c0-\u024f]", text):
        return "English"
    return "Auto"
