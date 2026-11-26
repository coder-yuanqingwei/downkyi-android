import { FFmpegKit, ReturnCode } from 'react-native-ffmpeg-kit';

/** FFmpeg 可用性：ffmpeg-kit 是随 app 打包的原生库，始终可用 */
export async function checkFfmpeg(): Promise<boolean> {
  try {
    const session = await FFmpegKit.execute('-version');
    const code = await session.getReturnCode();
    return ReturnCode.isSuccess(code);
  } catch {
    return false;
  }
}

/** 合并视频与音频流（不重编码，-c copy） */
export async function mergeMedia(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
  const command = `-y -i "${videoPath}" -i "${audioPath}" -c copy -movflags +faststart "${outputPath}"`;
  const session = await FFmpegKit.execute(command);
  const code = await session.getReturnCode();
  if (!ReturnCode.isSuccess(code)) {
    const logs = await session.getAllLogsAsString();
    throw new Error(`音视频合并失败：${(logs ?? '').slice(-500) || `退出码 ${code?.getValue()}`}`);
  }
}
