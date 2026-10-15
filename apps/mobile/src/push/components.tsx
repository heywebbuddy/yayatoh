import { px, radius, space, TOUCH_TARGET_PX, type, useColors } from '@yayatoh/mobile-core';
import { constant } from '@yayatoh/ui/tokens';
import { useEffect } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { scrubPushText } from './text';

export interface PrePromptProps {
  readonly visible: boolean;
  readonly onAllow: () => void;
  readonly onNotNow: () => void;
  /** True for the two P7-8 moments, where "Not now" is remembered and asked again after a purchase. */
  readonly remembers: boolean;
}

/**
 * The explanation shown before the phone's own sheet (`legal-copy`): what will be sent, what it
 * will never contain, and that saying no changes nothing. The phone's sheet appears only after
 * "Turn on notifications".
 */
export function PrePrompt({ visible, onAllow, onNotNow, remembers }: PrePromptProps) {
  const t = useTranslations('push.prompt');
  const colors = useColors();
  const items = ['orders', 'tickets', 'changes', 'reminders'] as const;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onNotNow}>
      <View style={[styles.scrim, { backgroundColor: colors.scrim }]} testID="push-preprompt">
        <SafeAreaView style={styles.sheetWrap} edges={['bottom', 'top']}>
          <View
            accessibilityViewIsModal
            style={[styles.sheet, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }]}
          >
            <ScrollView contentContainerStyle={styles.content}>
              <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
                {t('title')}
              </Text>
              <Text style={[styles.body, { color: colors.ink2 }]}>{t('intro')}</Text>
              {items.map((item) => (
                <View key={item} style={styles.item}>
                  <Text accessible={false} style={[styles.bullet, { color: colors.primaryInk }]}>
                    •
                  </Text>
                  <Text style={[styles.body, styles.itemText, { color: colors.ink }]}>
                    {t(`items.${item}`)}
                  </Text>
                </View>
              ))}
              <Text style={[styles.body, { color: colors.ink2 }]}>{t('privacy')}</Text>
              <Text style={[styles.body, { color: colors.ink2 }]}>
                {remembers ? t('againLater') : t('control')}
              </Text>
            </ScrollView>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('allow')}
                onPress={onAllow}
                style={[styles.button, { backgroundColor: colors.primary }]}
                testID="push-allow"
              >
                <Text style={[styles.buttonText, { color: colors.onPrimary }]}>{t('allow')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('notNow')}
                onPress={onNotNow}
                style={styles.button}
                testID="push-not-now"
              >
                <Text style={[styles.buttonText, { color: colors.primaryInk }]}>{t('notNow')}</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export interface ForegroundBannerProps {
  readonly title: string | null;
  readonly body: string | null;
  /** Can the banner be tapped to open a screen? */
  readonly openable: boolean;
  readonly onOpen: () => void;
  readonly onDismiss: () => void;
  readonly visibleMs?: number;
}

/** How long a banner stays before it goes away on its own. */
export const BANNER_VISIBLE_MS = 6000;

/**
 * A push that arrives while the app is open, drawn by the app instead of the system. The text is
 * the server's (event name and what changed); it is scrubbed again here so an email address, a
 * phone number or a long code could never be put on screen, even by a mistake upstream.
 */
export function ForegroundBanner({
  title,
  body,
  openable,
  onOpen,
  onDismiss,
  visibleMs = BANNER_VISIBLE_MS,
}: ForegroundBannerProps) {
  const t = useTranslations('push.banner');
  const colors = useColors();
  useEffect(() => {
    const timer = setTimeout(onDismiss, visibleMs);
    return () => clearTimeout(timer);
  }, [onDismiss, visibleMs]);
  const heading = scrubPushText(title) || t('fallbackTitle');
  const text = scrubPushText(body);
  return (
    <SafeAreaView edges={['top']} style={styles.bannerWrap} pointerEvents="box-none">
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.banner, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }]}
        testID="push-banner"
      >
        <Pressable
          accessibilityRole={openable ? 'button' : 'text'}
          accessibilityLabel={[heading, text].filter(Boolean).join('. ')}
          accessibilityHint={openable ? t('open') : undefined}
          disabled={!openable}
          onPress={onOpen}
          style={styles.bannerText}
          testID="push-banner-open"
        >
          <Text style={[styles.bannerTitle, { color: colors.ink }]}>{heading}</Text>
          {text ? <Text style={[styles.bannerBody, { color: colors.ink2 }]}>{text}</Text> : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('dismiss')}
          onPress={onDismiss}
          style={styles.dismiss}
          testID="push-banner-dismiss"
        >
          <Text accessible={false} style={[styles.dismissMark, { color: colors.ink2 }]}>
            ✕
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheetWrap: { justifyContent: 'flex-end', flexShrink: 1 },
  sheet: {
    borderWidth: StyleSheet.hairlineWidth,
    borderTopStartRadius: px(radius.card),
    borderTopEndRadius: px(radius.card),
    maxHeight: '100%',
  },
  content: { padding: space[6], gap: space[3] },
  title: { fontSize: 22, fontWeight: '800', textAlign: 'auto' },
  body: { fontSize: type.prose.size, lineHeight: type.prose.size * type.prose.lineHeight, textAlign: 'auto' },
  item: { flexDirection: 'row', gap: space[2] },
  bullet: { fontSize: type.prose.size },
  itemText: { flex: 1 },
  actions: { padding: space[4], gap: space[2] },
  button: {
    minHeight: TOUCH_TARGET_PX,
    borderRadius: px(radius.card),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  buttonText: { fontSize: type.prose.size, fontWeight: '700', textAlign: 'center' },
  bannerWrap: { position: 'absolute', top: 0, start: 0, end: 0, paddingHorizontal: space[3] },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: px(radius.card),
    paddingStart: space[4],
    shadowColor: constant.black,
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  bannerText: { flex: 1, minHeight: TOUCH_TARGET_PX, justifyContent: 'center', paddingVertical: space[2] },
  bannerTitle: { fontSize: type.prose.size, fontWeight: '700', textAlign: 'auto' },
  bannerBody: { fontSize: type.prose.size, textAlign: 'auto' },
  dismiss: {
    width: TOUCH_TARGET_PX,
    height: TOUCH_TARGET_PX,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissMark: { fontSize: 18 },
});
