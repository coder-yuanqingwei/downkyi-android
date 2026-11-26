import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, StatusBar, Alert } from 'react-native';
import type { AppSettings, AppView, DownloadTask, QrLoginStatus, RuntimeInfo } from './src/shared/types';
import { nativeApi } from './src/lib/native-api';
import { colors, spacing } from './src/lib/theme';
import { HomeScreen } from './src/components/HomeScreen';
import { DownloadsScreen } from './src/components/DownloadsScreen';
import { SettingsScreen } from './src/components/SettingsScreen';
import { LoginDialog } from './src/components/LoginDialog';

const tabs: Array<{ key: AppView; label: string; icon: string }> = [
  { key: 'home', label: '下载', icon: '⬇' },
  { key: 'downloads', label: '任务', icon: '≡' },
  { key: 'settings', label: '设置', icon: '⚙' },
];

export default function App() {
  const [view, setView] = useState<AppView>('home');
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [runtime, setRuntime] = useState<RuntimeInfo>({ platform: 'android', ffmpegAvailable: false, isDesktop: false });
  const [ready, setReady] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [qrKey, setQrKey] = useState('');
  const [qrStatus, setQrStatus] = useState<QrLoginStatus>('pending');
  const [qrMessage, setQrMessage] = useState('');
  const loginTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await nativeApi.init();
        const [initialTasks, initialSettings, initialRuntime] = await Promise.all([
          nativeApi.listTasks(),
          nativeApi.getSettings(),
          nativeApi.getRuntimeInfo(),
        ]);
        if (mounted) {
          setTasks(initialTasks);
          setSettings(initialSettings);
          setRuntime(initialRuntime);
          setReady(true);
        }
      } catch (err) {
        if (mounted) Alert.alert('初始化失败', err instanceof Error ? err.message : '未知错误');
      }
    })();
    const unsubscribe = nativeApi.onTasksChanged((next) => {
      if (mounted) setTasks(next);
    });
    return () => {
      mounted = false;
      unsubscribe();
      if (loginTimer.current) clearInterval(loginTimer.current);
    };
  }, []);

  const stopLoginPolling = useCallback(() => {
    if (loginTimer.current) {
      clearInterval(loginTimer.current);
      loginTimer.current = null;
    }
  }, []);

  const startLogin = async () => {
    try {
      const session = await nativeApi.loginGenerate();
      setQrUrl(session.url);
      setQrKey(session.qrcodeKey);
      setQrStatus('pending');
      setQrMessage('');
      setLoginOpen(true);
      stopLoginPolling();
      loginTimer.current = setInterval(async () => {
        try {
          const result = await nativeApi.loginPoll(session.qrcodeKey);
          setQrStatus(result.status);
          setQrMessage(result.message);
          if (result.status === 'success' && result.cookie) {
            const next = { ...(await nativeApi.getSettings()), cookie: result.cookie };
            await nativeApi.saveSettings(next);
            setSettings(next);
            stopLoginPolling();
            setLoginOpen(false);
            Alert.alert('登录成功', 'Cookie 已保存');
          } else if (result.status === 'expired') {
            stopLoginPolling();
          }
        } catch {
          // 单次轮询失败不中断
        }
      }, 1500);
    } catch (err) {
      Alert.alert('登录失败', err instanceof Error ? err.message : '未知错误');
    }
  };

  const closeLogin = () => {
    stopLoginPolling();
    setLoginOpen(false);
  };

  if (!ready || !settings) {
    return (
      <View style={styles.center}>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        <Text style={styles.loading}>正在加载 DownKyi...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <View style={styles.header}>
        <Text style={styles.appName}>DownKyi</Text>
        <Text style={styles.appSub}>B 站视频下载器 · Android</Text>
      </View>
      <View style={styles.body}>
        {view === 'home' && <HomeScreen api={nativeApi} onCreated={() => setView('downloads')} />}
        {view === 'downloads' && <DownloadsScreen api={nativeApi} tasks={tasks} />}
        {view === 'settings' && (
          <SettingsScreen
            api={nativeApi}
            settings={settings}
            runtime={runtime}
            onSettingsChange={setSettings}
            onLogin={() => void startLogin()}
          />
        )}
      </View>
      <View style={styles.tabBar}>
        {tabs.map((tab) => (
          <Pressable key={tab.key} style={styles.tab} onPress={() => setView(tab.key)}>
            <Text style={[styles.tabIcon, view === tab.key && styles.tabIconActive]}>{tab.icon}</Text>
            <Text style={[styles.tabLabel, view === tab.key && styles.tabLabelActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
      <LoginDialog open={loginOpen} qrUrl={qrUrl} status={qrStatus} message={qrMessage} onClose={closeLogin} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' },
  loading: { color: colors.textMuted, fontSize: 15 },
  header: { paddingTop: 44, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  appName: { color: colors.text, fontSize: 20, fontWeight: '800' },
  appSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  body: { flex: 1 },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, paddingBottom: 16, paddingTop: 6 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  tabIcon: { fontSize: 20, color: colors.textMuted },
  tabIconActive: { color: colors.primary },
  tabLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  tabLabelActive: { color: colors.primary, fontWeight: '700' },
});
