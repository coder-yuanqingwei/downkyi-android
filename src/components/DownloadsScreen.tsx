import React, { useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, Dimensions, Alert,
} from 'react-native';
import type { DownloadTask, DownKyiApi, TaskStatus } from '../shared/types';
import { formatBytes, statusLabel } from '../shared/format';
import { colors, spacing } from '../lib/theme';

interface Props {
  api: DownKyiApi;
  tasks: DownloadTask[];
}

const filters: Array<{ key: 'all' | 'active' | 'completed' | 'failed'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '进行中' },
  { key: 'completed', label: '已完成' },
  { key: 'failed', label: '失败' },
];

function inFilter(task: DownloadTask, filter: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return ['queued', 'downloading', 'paused', 'merging'].includes(task.status);
  return task.status === filter;
}

export function DownloadsScreen({ api, tasks }: Props) {
  const [filter, setFilter] = useState('all');
  const shown = tasks.filter((task) => inFilter(task, filter));

  const confirmRemove = (task: DownloadTask) => {
    Alert.alert('移除任务', `移除「${task.title}」的任务记录？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '仅记录',
        onPress: () => void api.removeTask(task.id),
      },
      {
        text: '同时删除文件',
        style: 'destructive',
        onPress: () => void api.removeTask(task.id, true),
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.filterRow}>
        {filters.map((item) => (
          <Pressable
            key={item.key}
            style={[styles.filterChip, filter === item.key && styles.filterChipActive]}
            onPress={() => setFilter(item.key)}
          >
            <Text style={[styles.filterText, filter === item.key && styles.filterTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {shown.length === 0 ? (
          <Text style={styles.empty}>暂无任务</Text>
        ) : (
          shown.map((task) => <TaskCard key={task.id} task={task} api={api} onRemove={() => confirmRemove(task)} />)
        )}
      </ScrollView>
      {tasks.some((t) => t.status === 'completed') && (
        <Pressable style={styles.clearButton} onPress={() => void api.clearCompleted()}>
          <Text style={styles.clearText}>清理已完成记录</Text>
        </Pressable>
      )}
    </View>
  );
}

function TaskCard({ task, api, onRemove }: { task: DownloadTask; api: DownKyiApi; onRemove: () => void }) {
  const statusColors: Partial<Record<TaskStatus, string>> = {
    completed: colors.success,
    failed: colors.danger,
    downloading: colors.info,
    merging: colors.warning,
  };
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle} numberOfLines={2}>{task.title}</Text>
      <Text style={styles.cardPage} numberOfLines={1}>{task.pageTitle} · {task.qualityLabel}</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${task.progress}%` }]} />
      </View>
      <View style={styles.cardMeta}>
        <Text style={[styles.status, { color: statusColors[task.status] ?? colors.textMuted }]}>
          {statusLabel(task.status)} {task.progress.toFixed(1)}%
        </Text>
        <Text style={styles.metaText}>
          {formatBytes(task.downloadedBytes)} / {formatBytes(task.totalBytes)}
          {task.speed > 0 ? ` · ${formatBytes(task.speed)}/s` : ''}
        </Text>
      </View>
      {task.error ? <Text style={styles.error} numberOfLines={2}>{task.error}</Text> : null}
      <View style={styles.actions}>
        {task.status === 'downloading' || task.status === 'queued' ? (
          <Pressable style={styles.action} onPress={() => void api.pauseTask(task.id)}>
            <Text style={styles.actionText}>暂停</Text>
          </Pressable>
        ) : null}
        {task.status === 'paused' ? (
          <Pressable style={styles.action} onPress={() => void api.resumeTask(task.id)}>
            <Text style={styles.actionText}>继续</Text>
          </Pressable>
        ) : null}
        {task.status === 'failed' ? (
          <Pressable style={styles.action} onPress={() => void api.retryTask(task.id)}>
            <Text style={styles.actionText}>重试</Text>
          </Pressable>
        ) : null}
        <Pressable style={[styles.action, styles.actionDanger]} onPress={onRemove}>
          <Text style={[styles.actionText, styles.actionDangerText]}>移除</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  filterRow: { flexDirection: 'row', gap: 8, padding: spacing.md, paddingBottom: spacing.sm },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterChipActive: { backgroundColor: colors.primaryDim, borderColor: colors.primary },
  filterText: { color: colors.textMuted, fontSize: 13 },
  filterTextActive: { color: colors.text, fontWeight: '700' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: 80 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 60 },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, marginBottom: spacing.sm },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  cardPage: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  progressTrack: { height: 6, backgroundColor: colors.surfaceAlt, borderRadius: 3, marginTop: spacing.sm, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  status: { fontSize: 12, fontWeight: '700' },
  metaText: { color: colors.textMuted, fontSize: 11 },
  error: { color: colors.danger, fontSize: 11, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: spacing.md },
  action: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6, backgroundColor: colors.surfaceAlt },
  actionDanger: { marginLeft: 'auto' },
  actionText: { color: colors.text, fontSize: 12 },
  actionDangerText: { color: colors.danger },
  clearButton: { padding: spacing.md, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border },
  clearText: { color: colors.primary, fontSize: 13 },
});
