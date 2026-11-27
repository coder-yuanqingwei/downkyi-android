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
  console.log('[patch] ffmpeg-kit-react-native not found, skip');
  process.exit(0);
}

let content = fs.readFileSync(gradlePath, 'utf8');
const marker = '// PATCHED: local aar from android/libs';

const mavenLine =
  "  implementation 'com.arthenica:ffmpeg-kit-' + safePackageName(safeExtGet('ffmpegKitPackage', 'https')) + ':' + safePackageVersion(safeExtGet('ffmpegKitPackage', 'https'))";

const patchedBlock = `  ${marker}
  // 本地 aar 由 CI 下载到 android/libs/，通过 flatDir 仓库解析
  def aarDir = new File(rootProject.projectDir, 'libs')
  def localAar = aarDir.listFiles()?.find { it.name.startsWith('ffmpeg-kit-') && it.name.endsWith('.aar') }
  if (localAar) {
    implementation(name: localAar.name.substring(0, localAar.name.length() - 4), ext: 'aar')
  } else {
${mavenLine}
  }`;

if (!content.includes(mavenLine)) {
  console.warn('[patch] dependency line not found, patch skipped');
  process.exit(0);
}

content = content.replace(mavenLine, patchedBlock);
fs.writeFileSync(gradlePath, content, 'utf8');
console.log('[patch] patched ffmpeg-kit-react-native to use local aar');

/**
 * react-native-svg 15.x 的 fabric 规范文件用命名空间类型
 * （`CodegenTypes.WithDefault<Float, ...>`），RN 0.79 的 babel codegen 插件
 * 无法解析命名空间限定类型，Metro 打包时报
 * "Unknown prop type for opacity: undefined"。
 * 这里改写为具名导入（svg 13.x 的写法），babel 可正常解析。
 */
const CODEGEN_TYPE_NAMES = [
  'Double',
  'Float',
  'Int32',
  'WithDefault',
  'DirectEventHandler',
  'BubblingEventHandler',
  'UnsafeObject',
  'UnsafeMixed',
];

function patchSvgFabric() {
  const fabricDir = path.join(
    __dirname,
    '..',
    'node_modules',
    'react-native-svg',
    'src',
    'fabric',
  );
  if (!fs.existsSync(fabricDir)) {
    console.log('[patch] react-native-svg fabric dir not found, skip');
    return;
  }

  let changed = 0;
  for (const name of fs.readdirSync(fabricDir)) {
    if (!/\.tsx?$/.test(name)) continue;
    const file = path.join(fabricDir, name);
    let src = fs.readFileSync(file, 'utf8');
    if (!src.includes('CodegenTypes.')) continue; // 已处理或未使用

    // 1. 命名空间引用改为裸类型名
    src = src.replace(/CodegenTypes\.(\w+)/g, '$1');

    // 2. 收集实际用到的类型，排除文件中已有导入，生成具名导入
    const existing = new Set();
    for (const m of src.matchAll(/import[^;{]*\{([^}]*)\}/g)) {
      for (const n of m[1].split(',')) {
        const id = n.trim().split(/\s+as\s+/)[0];
        if (id) existing.add(id);
      }
    }
    const used = CODEGEN_TYPE_NAMES.filter(
      (t) => new RegExp(`\\b${t}\\b`).test(src) && !existing.has(t),
    );

    // 3. 从 react-native 的类型导入里去掉 CodegenTypes
    src = src.replace(
      /import type \{([^}]*)\} from 'react-native';/g,
      (m, names) => {
        const rest = names
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s && s !== 'CodegenTypes');
        if (rest.length === 0) return '';
        return `import type { ${rest.join(', ')} } from 'react-native';`;
      },
    );

    // 4. 在首个 import 之后插入具名 CodegenTypes 导入
    const importLine = `import type { ${used.join(', ')} } from 'react-native/Libraries/Types/CodegenTypes';`;
    const idx = src.indexOf('import ');
    const lineEnd = src.indexOf('\n', idx);
    src =
      src.slice(0, lineEnd + 1) + importLine + '\n' + src.slice(lineEnd + 1);

    fs.writeFileSync(file, src, 'utf8');
    changed++;
  }
  console.log(
    `[patch] rewrote CodegenTypes namespace imports in ${changed} svg fabric files`,
  );
}

patchSvgFabric();
