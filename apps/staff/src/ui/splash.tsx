import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { px, radius, space, type, useColors } from '../theme';

/** Shown while the app reads its stored enrolment: one translated string, styled from the tokens only. */
export function Splash() {
  const t = useTranslations('home');
  const colors = useColors();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View
        style={[styles.card, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }]}
        testID="home-card"
      >
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
          {t('title')}
        </Text>
        <Text style={[styles.tagline, { color: colors.ink2 }]}>{t('tagline')}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', paddingHorizontal: space[4] },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: px(radius.card),
    paddingHorizontal: space[6],
    paddingVertical: space[8],
    gap: space[2],
  },
  // Logical alignment: `auto` follows the text's own direction, so Arabic reads right to left.
  title: { fontSize: 28, fontWeight: '800', textAlign: 'auto' },
  tagline: {
    fontSize: type.prose.size,
    lineHeight: type.prose.size * type.prose.lineHeight,
    textAlign: 'auto',
  },
});
