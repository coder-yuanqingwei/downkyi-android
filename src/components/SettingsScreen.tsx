import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert,
} from 'react-native';
import type { AppSettings, DownKyiApi, RuntimeInfo } from '../shared/types';
import { colors, spacing } from '../lib/theme';

interface Props {
  api: DownKyiApi;
  settings: AppSettings;
  runtime: RuntimeInfo;
  onSettingsChange: (settings: AppSettings) => void;
  onLogin: () => void;
}

export function SettingsScreen({ api, settings, runtime, onSettingsChange, onLogin }: Props) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveSettings(draft);
      onSettingsChange(draft);
      Alert.alert('已保存', '设置已保存');
    } catch (err) {
      Alert.alert('保存失败', err instanceof Error ? err.message : '未知错误');
    } finally {
      setSaving(false);
    }
  };

  const patch = (value: Partial<AppSettings>) => setDraft((prev) => ({ ...prev, ...value }));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>偏好设置</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>账号</Text>
        <Text style={styles.hint}>登录后可以下载高画质内容</Text>
        <Pressable style={styles.loginButton} onPress={onLogin}>
          <Text style={styles.loginButtonText}>扫码登录</Text>
        </Pressable>
        <Text style={styles.label}>手动填写 Cookie（SESSDATA 等）</Text>
        <TextInput
          style={styles.input}
          value={draft.cookie}
          onChangeText={(value) => patch({ cookie: value })}
          placeholder="SESSDATA=xxx; bili_jct=xxx; ..."
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          multiline
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>下载</Text>
        <Text style={styles.label}>最大并发数（1-5）：{draft.maxConcurrent}</Text>
        <View style={styles.row}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} style={[styles.numberChip, draft.maxConcurrent === n && styles.numberChipActive]} onPress={() => patch({ maxConcurrent: n })}>
              <Text style={[styles.numberText, draft.maxConcurrent === n && styles.numberTextActive]}>{n}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.label}>默认画质 ID（如 80=1080P，64=720P）</Text>
        <TextInput
          style={styles.input}
          value={String(draft.defaultQuality)}
          onChangeText={(value) => patch({ defaultQuality: Number(value) || 80 })}
          keyboardType="numeric"
          placeholderTextColor={colors.textMuted}
        />
        <Text style={styles.label}>文件命名模板</Text>
        <TextInput
          style={styles.input}
          value={draft.fileNameTemplate}
          onChangeText={(value) => patch({ fileNameTemplate: value })}
          placeholderTextColor={colors.textMuted}
        />
        <Pressable style={styles.checkRow} onPress={() => patch({ autoStart: !draft.autoStart })}>
          <Text style={styles.checkText}>{draft.autoStart ? '☑' : '☐'} 创建后自动开始下载</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>附加内容</Text>
        <Pressable style={styles.checkRow} onPress={() => patch({ downloadExtras: !draft.downloadExtras })}>
          <Text style={styles.checkText}>{draft.downloadExtras ? '☑' : '☐'} 默认下载字幕/封面/元数据</Text>
        </Pressable>
        <Pressable style={styles.checkRow} onPress={() => patch({ downloadDanmaku: !draft.downloadDanmaku })}>
          <Text style={styles.checkText}>{draft.downloadDanmaku ? '☑' : '☐'} 默认下载弹幕</Text>
        </Pressable>
        <Text style={styles.label}>字幕语言（ai-zh / ai-en / none）</Text>
        <TextInput
          style={styles.input}
          value={draft.subtitleLanguage}
          onChangeText={(value) => patch({ subtitleLanguage: value })}
          placeholderTextColor={colors.textMuted}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>运行环境</Text>
        <Text style={styles.metaText}>平台：{runtime.platform}</Text>
        <Text style={styles.metaText}>FFmpeg：{runtime.ffmpegAvailable ? '可用' : '不可用'}</Text>
        <Text style={styles.metaText}>下载目录：{draft.downloadDir}</Text>
      </View>

      <Pressable style={styles.saveButton} onPress={() => void save()} disabled={saving}>
        <Text style={styles.saveButtonText}>{saving ? '保存中...' : '保存设置'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: 60 },
  heading: { color: colors.text, fontSize: 24, fontWeight: '800', marginBottom: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, marginBottom: spacing.md },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm },
  hint: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.sm },
  label: { color: colors.textMuted, fontSize: 12, marginTop: spacing.md, marginBottom: 6 },
  input: { backgroundColor: colors.surfaceAlt, color: colors.text, borderRadius: 8, padding: 10, fontSize: 13, minHeight: 40 },
  row: { flexDirection: 'row', gap: 8 },
  numberChip: { width: 40, height: 36, borderRadius: 8, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  numberChipActive: { backgroundColor: colors.primaryDim },
  numberText: { color: colors.textMuted, fontSize: 14 },
  numberTextActive: { color: colors.text, fontWeight: '700' },
  checkRow: { marginTop: spacing.md },
  checkText: { color: colors.text, fontSize: 14 },
  loginButton: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: spacing.sm },
  loginButtonText: { color: '#fff', fontWeight: '700' },
  metaText: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  saveButton: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  saveButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
