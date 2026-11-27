import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, Platform, StyleSheet, View } from 'react-native';

const campusImage = require('../assets/campus-siyuan.png');
const campusWidth = 1586;
const campusHeight = 992;

// Coordinates on the illustrated overflow edge, in the same space as the background.
const widePoolEdge = [
  { left: '10.3%', top: '85.4%', offset: 0.07 },
  { left: '12.8%', top: '85.8%', offset: 0.68 },
  { left: '15.2%', top: '86.1%', offset: 0.31 },
  { left: '17.3%', top: '86.3%', offset: 0.86 },
  { left: '20.1%', top: '86.1%', offset: 0.49 },
  { left: '23.6%', top: '85.4%', offset: 0.19 },
] as const;

const compactPoolEdge = [
  { left: 36, top: 39.3, offset: 0.08 },
  { left: 42, top: 40.4, offset: 0.66 },
  { left: 48, top: 41.1, offset: 0.26 },
  { left: 54, top: 40.5, offset: 0.84 },
  { left: 61, top: 39.4, offset: 0.44 },
];

export function SiyuanCampusBackdrop() {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const scale = Math.max(viewport.width / campusWidth, viewport.height / campusHeight);
  const width = campusWidth * scale;
  const height = campusHeight * scale;

  return (
    <View pointerEvents="none" style={styles.backdrop} onLayout={({ nativeEvent: { layout } }) => {
      setViewport({ width: layout.width, height: layout.height });
    }}>
      <Image source={campusImage} style={styles.illustration} resizeMode="cover" accessible={false} testID="siyuan-campus-print" />
      {scale > 0 && (
        <View style={[styles.canvas, { width, height, left: (viewport.width - width) / 2, top: (viewport.height - height) / 2 }]}>
          <SiyuanFountain scale={scale} />
        </View>
      )}
    </View>
  );
}

export function SiyuanFountain({ compact = false, scale = 1 }: { compact?: boolean; scale?: number }) {
  const [phase] = useState(() => new Animated.Value(0));
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    }).catch(() => {});
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const flow = Animated.loop(Animated.timing(phase, {
      toValue: 1, duration: compact ? 5600 : 4600, easing: Easing.linear, isInteraction: false,
      useNativeDriver: Platform.OS !== 'web',
    }));
    flow.start();
    return () => flow.stop();
  }, [compact, phase, reduceMotion]);

  return (
    <View
      style={compact ? styles.compactScene : styles.scene} pointerEvents="none" accessible accessibilityRole="image"
      accessibilityLabel="饮水思源碑与水池" testID="siyuan-fountain"
    >
      {compact && <Image source={require('../assets/siyuan-fountain-mini.png')}
        style={styles.compactIllustration} accessible={false} resizeMode="contain" />}
      {!reduceMotion && (compact ? compactPoolEdge : widePoolEdge).map(({ left, top, offset }, index) => {
        const drop = Animated.modulo(Animated.add(phase, offset), 1);
        return (
          <Animated.View key={offset} testID={index === 0 ? 'siyuan-cascade' : undefined} style={[styles.cascade, compact && styles.compactCascade, {
            left, top,
            opacity: drop.interpolate({
              inputRange: [0, 0.2, 0.72, 1],
              outputRange: compact ? [0, 0.48, 0.38, 0] : [0, 0.58, 0.45, 0],
            }),
            transform: [{ translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [0, compact ? 3.2 : 17 * scale] }) }],
          }]} />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, opacity: 0.72 },
  canvas: { position: 'absolute' },
  scene: { ...StyleSheet.absoluteFill },
  compactScene: { width: 72, height: 48, alignSelf: 'center', marginTop: -6, marginBottom: -6 },
  illustration: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  compactIllustration: { position: 'absolute', top: 0, left: 29, width: 39, height: 48, opacity: 0.73 },
  cascade: { position: 'absolute', width: 0.85, height: 4.5, borderRadius: 1, backgroundColor: '#658590' },
  compactCascade: { width: 0.52, height: 2.8 },
});
