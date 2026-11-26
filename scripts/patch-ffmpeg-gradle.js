/**
 * postinstall：把 ffmpeg-kit-react-native 的 Maven 依赖改为本地 aar。
 * 官方 Maven 构件 com.arthenica:ffmpeg-kit-https:6.0-2 已从 Maven Central 下架，
 * CI 会把维护版 aar 下载到 android/libs/，这里让库改用本地文件依赖。
 */
const fs = require('fs');
const path = require('path');

const gradlePath = path.join(
  __dirname,
  '..',
  'node_modules',
  'ffmpeg-kit-react-native',
  'android',
  'build.gradle',
);

if (!fs.existsSync(gradlePath)) {
  console.log('[patch-ffmpeg] ffmpeg-kit-react-native not found, skip');
  process.exit(0);
}

let content = fs.readFileSync(gradlePath, 'utf8');
const marker = '// PATCHED: local aar from android/libs';
if (content.includes(marker)) {
  console.log('[patch-ffmpeg] already patched');
  process.exit(0);
}

const original = `  implementation 'com.arthenica:ffmpeg-kit-' + safePackageName(safeExtGet('ffmpegKitPackage', 'https')) + ':' + safePackageVersion(safeExtGet('ffmpegKitPackage', 'https'))`;
const patched = `  ${marker}
  // 本地 aar 由 CI 下载到 android/libs/，通过 flatDir 仓库解析
  def aarDir = new File(rootProject.projectDir, 'libs')
  def localAar = aarDir.listFiles()?.find { it.name.startsWith('ffmpeg-kit-') && it.name.endsWith('.aar') }
  if (localAar) {
    implementation(name: localAar.name.replace(/\\.aar$/, ''), ext: 'aar')
  } else {
    implementation 'com.arthenica:ffmpeg-kit-' + safePackageName(safeExtGet('ffmpegKitPackage', 'https')) + ':' + safePackageVersion(safeExtGet('ffmpegKitPackage', 'https'))
  }`;

if (!content.includes(original)) {
  console.warn('[patch-ffmpeg] original dependency line not found, patch skipped');
  process.exit(0);
}

content = content.replace(original, patched);
fs.writeFileSync(gradlePath, content, 'utf8');
console.log('[patch-ffmpeg] patched ffmpeg-kit-react-native to use local aar');
