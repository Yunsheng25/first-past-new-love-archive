import { spawn } from "node:child_process";

function timeToSeconds(hours, minutes, seconds) {
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

export function parseFfmpegInfo(text) {
  const durationMatch = text.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  const videoLine = text.split(/\r?\n/).find((line) => /Stream #.*Video:/.test(line));
  const audioLine = text.split(/\r?\n/).find((line) => /Stream #.*Audio:/.test(line));

  if (!durationMatch || !videoLine) {
    throw new Error("FFmpeg 输出中缺少时长或视频流信息");
  }

  const codecMatch = videoLine.match(/Video:\s*([^\s,(]+)/);
  const pixelFormatMatch = videoLine.match(/,\s*((?:yuv|yuva|nv|p0|rgb|bgr|gbr)[a-z0-9]+)(?:\([^)]*\))?\s*,/i);
  const dimensionsMatch = videoLine.match(/,\s*(\d{2,5})x(\d{2,5})(?:\s|\[|,)/);
  if (!codecMatch || !pixelFormatMatch || !dimensionsMatch) {
    throw new Error("无法解析 FFmpeg 视频流信息");
  }

  let audio = null;
  if (audioLine) {
    const audioCodec = audioLine.match(/Audio:\s*([^\s,(]+)/);
    const sampleRate = audioLine.match(/,\s*(\d+)\s*Hz/);
    const channels = audioLine.match(/,\s*(mono|stereo|\d+(?:\.\d+)?(?:\([^)]*\))?)\s*,/i);
    if (!audioCodec || !sampleRate || !channels) {
      throw new Error("无法解析 FFmpeg 音频流信息");
    }
    audio = {
      codec: audioCodec[1].toLowerCase(),
      sampleRate: Number(sampleRate[1]),
      channels: channels[1].toLowerCase(),
    };
  }

  return {
    durationSeconds: timeToSeconds(durationMatch[1], durationMatch[2], durationMatch[3]),
    video: {
      codec: codecMatch[1].toLowerCase(),
      pixelFormat: pixelFormatMatch[1].toLowerCase(),
      width: Number(dimensionsMatch[1]),
      height: Number(dimensionsMatch[2]),
    },
    audio,
  };
}

export async function readVideoMetadata(ffmpegPath, mediaPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-i", mediaPath], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let diagnostic = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      diagnostic += chunk;
    });
    child.on("error", reject);
    child.on("close", () => {
      try {
        resolve(parseFfmpegInfo(diagnostic));
      } catch (error) {
        reject(new Error(`${error.message}: ${mediaPath}`));
      }
    });
  });
}
