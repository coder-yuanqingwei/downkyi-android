# DownKyi Android

B 站视频下载器的安卓版本，基于 React Native 0.79。功能与桌面端对齐：扫码登录、画质选择、多分集批量下载、断点续传、字幕/弹幕/封面/NFO 元数据。

## 功能

- **链接解析**：支持 b23.tv 短链、完整链接、分享文本、BV/av 号
- **画质选择**：读取实际 DASH 流，标注分辨率；多分集取画质交集
- **下载管理**：并发控制、进度/速度显示、暂停/继续/重试/删除、断点续传（HTTP Range）
- **音视频合并**：ffmpeg-kit 原生合并 `-c copy`，无需重编码
- **附加内容**：AI 字幕（SRT）、弹幕（ASS）、封面（poster.jpg）、NFO 元数据
- **扫码登录**：哔哩哔哩 App 扫码，Cookie 持久化到本地

## 下载 APK

进入 [Releases](../../releases) 页面下载最新 `downkyi-android-release.apk`（打 tag `v*` 会自动构建并发布）。

也可以在 Actions 页面手动触发 `Build Android APK`，构建产物在 Artifacts 中。

## 本地开发

需要 Node 20+、JDK 17、Android SDK（API 35）。

```bash
npm install
npm run typecheck
npx react-native run-android
```

用 Android Studio 打开 `android/` 目录也可以直接构建。

## 技术说明

| 功能 | 实现 |
|---|---|
| 网络请求 | RN `fetch`（B 站 Web API，带 Cookie/Referer/UA） |
| 文件下载 | `@dr.pogodin/react-native-fs` 原生下载 + Range 断点续传 |
| 音视频合并 | `ffmpeg-kit-react-native`（https 包，`-c copy`） |
| 持久化 | `@react-native-async-storage/async-storage` |
| 二维码 | `react-native-qrcode-svg` |
| UI | React Native 原生组件（StyleSheet） |

下载文件默认保存在 App 专属目录（`DocumentDirectoryPath/DownKyi`），安卓 10+ 的 Scoped Storage 限制下无需额外权限。

## 已知限制

- 充电专属内容无法下载（需登录并对 UP 主充电，本项目不绕过付费限制）
- 下载目录暂固定为 App 专属目录，SAF 自定义目录选择留待后续版本
- 后台下载使用 RNFS 的 background 选项，长时间后台可能被系统限制
- Release APK 使用 debug keystore 签名（便于自动构建），适合个人使用
