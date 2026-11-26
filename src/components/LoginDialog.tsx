import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type { QrLoginStatus } from '../shared/types';
import { colors, spacing } from '../lib/theme';

interface Props {
  open: boolean;
  qrUrl: string;
  status: QrLoginStatus;
  message: string;
  onClose: () => void;
}

const statusText: Record<QrLoginStatus, string> = {
  pending: '请使用哔哩哔哩 App 扫码登录',
  scanned: '已扫码，请在手机上确认',
  success: '登录成功',
  expired: '二维码已过期，请重新获取',
};

export function LoginDialog({ open, qrUrl, status, message, onClose }: Props) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>扫码登录</Text>
          <Text style={styles.subtitle}>{statusText[status] ?? message}</Text>
          <View style={styles.qrBox}>
            {qrUrl ? <QRCode value={qrUrl} size={210} color={colors.text} backgroundColor="#fff" /> : <ActivityIndicator color={colors.primary} />}
          </View>
          {status === 'expired' && (
            <Pressable style={styles.button} onPress={onClose}>
              <Text style={styles.buttonText}>关闭</Text>
            </Pressable>
          )}
          <Pressable onPress={onClose}>
            <Text style={styles.cancel}>取消</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  card: { width: '100%', maxWidth: 340, backgroundColor: colors.surface, borderRadius: 16, padding: spacing.lg, alignItems: 'center' },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: spacing.sm },
  subtitle: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginBottom: spacing.md },
  qrBox: { backgroundColor: '#fff', padding: 12, borderRadius: 12, minHeight: 234, justifyContent: 'center', alignItems: 'center' },
  button: { marginTop: spacing.md, backgroundColor: colors.primary, paddingHorizontal: 28, paddingVertical: 10, borderRadius: 8 },
  buttonText: { color: '#fff', fontWeight: '700' },
  cancel: { color: colors.textMuted, marginTop: spacing.md, fontSize: 14 },
});
