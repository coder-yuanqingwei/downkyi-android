import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { commonQualities, selectQuality } from '../shared/quality';
import { formatCompactNumber, formatDuration } from '../shared/format';
import type { DownKyiApi, QualityOption, VideoInfo } from '../shared/types';
import { colors, spacing } from '../lib/theme';

interface Props {
  api: DownKyiApi;
  onCreated: () => void;
}

export function HomeScreen({ api, onCreated }: Props) {
  const [input, setInput] = useState('');
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [qualities, setQualities] = useState<QualityOption[]>([]);
  const [quality, setQuality] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [audioOnly, setAudioOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const qualityCache = useRef(new Map<number, QualityOption[]>());

  const handleParse = async () => {
    setError('');
    setLoading(true);
    setVideo(null);
    try {
      const result = await api.parseVideo(input);
      setVideo(result);
      setSelected(new Set(result.pages.map((page) => page.cid)));
      qualityCache.current.clear();
      // 只查首集画质，避免 B 站风控（87008）
      if (result.pages[0]) {
        const list = await api.getQualities(result.bvid, result.pages[0].cid);
        setQualities(list);
        const settings = await api.getSettings();
        setQuality(selectQuality(settings.defaultQuality, list).id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析失败');
    } finally {
      setLoading(false);
    }
  };

  const togglePage = (cid: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  };

  const handleDownload = async () => {
    if (!video || !quality || selected.size === 0) return;
    const pageIds = Array.from(selected);
    try {
      // 多分集画质取交集，保证每个分集都能下
      const lists: QualityOption[][] = [];
      for (const cid of pageIds.slice(0, 3)) {
        const cached = qualityCache.current.get(cid);
        if (cached) lists.push(cached);
        else {
          const list = await api.getQualities(video.bvid, cid);
          qualityCache.current.set(cid, list);
          lists.push(list);
        }
      }
      const usable = lists.length ? commonQualities(lists) : qualities;
      const chosen = selectQuality(quality, usable.length ? usable : qualities);
      const qLabel = (usable.length ? usable : qualities).find((q) => q.id === chosen.id)?.label ?? `${chosen.id}`;
      await api.createDownloads({
        video,
        pageIds,
        quality: chosen.id,
        qualityLabel: qLabel,
        audioOnly,
        outputDir: (await api.getSettings()).downloadDir,
      });
      Alert.alert('已创建任务', `已加入 ${pageIds.length} 个下载任务`);
      setVideo(null);
      setInput('');
      onCreated();
    } catch (err) {
      Alert.alert('创建失败', err instanceof Error ? err.message : '未知错误');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>新建下载</Text>
      <Text style={styles.hint}>粘贴视频链接、分享文本或 BV 号</Text>
      <TextInput
        style={styles.input}
        value={input}
        onChangeText={setInput}
        placeholder="https://b23.tv/... 或 BV1xx411c7XX"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        multiline
      />
      <Pressable style={styles.primaryButton} onPress={() => void handleParse()} disabled={loading || !input.trim()}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>解析视频</Text>}
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {video && (
        <View style={styles.card}>
          <Text style={styles.videoTitle}>{video.title}</Text>
          <Text style={styles.meta}>
            {video.owner} · {formatDuration(video.duration)} · {formatCompactNumber(video.viewCount)} 播放
          </Text>
          <Text style={styles.sectionLabel}>画质</Text>
          <View style={styles.chips}>
            {qualities.map((q) => (
              <Pressable
                key={q.id}
                style={[styles.chip, quality === q.id && styles.chipActive]}
                onPress={() => setQuality(q.id)}
              >
                <Text style={[styles.chipText, quality === q.id && styles.chipTextActive]}>
                  {q.label}{q.width ? `\n${q.width}×${q.height}` : ''}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.sectionLabel}>分集（已选 {selected.size}/{video.pages.length}）</Text>
          {video.pages.map((page) => {
            const active = selected.has(page.cid);
            return (
              <Pressable key={page.cid} style={[styles.pageRow, active && styles.pageRowActive]} onPress={() => togglePage(page.cid)}>
                <Text style={[styles.pageTitle, active && styles.pageTitleActive]}>
                  {active ? '☑' : '☐'} P{page.index} {page.title}
                </Text>
                <Text style={styles.pageDuration}>{formatDuration(page.duration)}</Text>
              </Pressable>
            );
          })}

          <Pressable style={styles.checkRow} onPress={() => setAudioOnly((v) => !v)}>
            <Text style={styles.checkText}>{audioOnly ? '☑' : '☐'} 仅下载音频</Text>
          </Pressable>

          <Pressable style={[styles.primaryButton, styles.downloadButton]} onPress={() => void handleDownload()} disabled={!quality || selected.size === 0}>
            <Text style={styles.primaryButtonText}>开始下载（{selected.size} 集）</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: 60 },
  heading: { color: colors.text, fontSize: 24, fontWeight: '800', marginBottom: 4 },
  hint: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.md },
  input: {
    backgroundColor: colors.surface, color: colors.text, borderRadius: 10, padding: spacing.md,
    fontSize: 14, minHeight: 88, borderWidth: 1, borderColor: colors.border,
  },
  primaryButton: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: spacing.md },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  downloadButton: { marginTop: spacing.lg },
  error: { color: colors.danger, marginTop: spacing.sm, fontSize: 13 },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, marginTop: spacing.lg },
  videoTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 4, marginBottom: spacing.md },
  sectionLabel: { color: colors.text, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primaryDim, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  chipTextActive: { color: colors.text, fontWeight: '700' },
  pageRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  pageRowActive: {},
  pageTitle: { color: colors.textMuted, fontSize: 13, flex: 1 },
  pageTitleActive: { color: colors.text },
  pageDuration: { color: colors.textMuted, fontSize: 12 },
  checkRow: { marginTop: spacing.md },
  checkText: { color: colors.text, fontSize: 14 },
});
