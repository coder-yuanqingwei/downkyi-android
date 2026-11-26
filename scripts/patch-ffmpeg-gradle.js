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

// 幂等：若已打过补丁，先移除补丁块（保留原有 dependencies 声明），再重新打
if (content.includes(marker)) {
  const patchedMark = `  ${marker}`;
  const idx = content.indexOf(patchedMark);
  if (idx !== -1) {
    // 补丁块从 marker 前一行开始，到其对应的闭合 } 结束；简单起见截到 dependencies 块起始
    const before = content.slice(0, idx);
    const depIdxs = [...before.matchAll(/^dependencies \{/gm)];
    const depIdx = depIdxs.length ? depIdxs[depIdxs.length - 1].index : -1;
    if (depIdx !== -1) {
      content = content.slice(0, depIdx) + 'dependencies {\n  api \'com.facebook.react:react-native:+\'\n}\n';
    }
  }
}

// 只匹配行首无缩进的 dependencies 块（buildscript 内的那个带缩进）
const depMatches = [...content.matchAll(/^dependencies \{/gm)];
const depStart = depMatches.length ? depMatches[depMatches.length - 1].index : -1;
if (depStart === -1) {
  console.warn('[patch-ffmpeg] dependencies block not found, patch skipped');
  process.exit(0);
}

const patchedBlock = `dependencies {
  api 'com.facebook.react:react-native:+'
  ${marker}
  // 本地 aar 由 CI 下载到 android/libs/，通过 flatDir 仓库解析
  def aarDir = new File(rootProject.projectDir, 'libs')
  def localAar = aarDir.listFiles()?.find { it.name.startsWith('ffmpeg-kit-') && it.name.endsWith('.aar') }
  if (localAar) {
    implementation(name: localAar.name.substring(0, localAar.name.length - 4), ext: 'aar')
  } else {
    implementation 'com.arthenica:ffmpeg-kit-' + safePackageName(safeExtGet('ffmpegKitPackage', 'https')) + ':' + safePackageVersion(safeExtGet('ffmpegKitPackage', 'https'))
  }
}
`;

content = content.slice(0, depStart) + patchedBlock;
fs.writeFileSync(gradlePath, content, 'utf8');
console.log('[patch-ffmpeg] patched ffmpeg-kit-react-native to use local aar');
