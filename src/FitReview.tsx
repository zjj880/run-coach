import { brandTheme } from './brandTheme';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { FitActivity, FitLap } from './fit';
import { chartBounds, chartTime, heartSampleAt } from './fitCharts';

const height = 112;
const barWidth = 34;

function Grid() {
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {[0, 0.5, 1].map((fraction) => <View key={fraction} style={[styles.grid, { top: Math.min(height - 1, fraction * height) }]} />)}
  </View>;
}

function LapChart({ laps }: { laps: FitLap[] }) {
  const [selectedNumber, setSelectedNumber] = useState<number>();
  const [showAll, setShowAll] = useState(false);
  const paces = laps.flatMap((lap) => lap.paceSecPerKm ? [lap.paceSecPerKm] : []);
  const scale = chartBounds(paces, 15, 10);
  const selected = laps.find((lap) => lap.number === selectedNumber);

  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.label}>逐圈配速</Text>
    {!laps.length ? <Text style={styles.small}>这条活动没有圈记录。</Text> : <>
      {scale ? <>
        <Text style={styles.small}>{laps.length} 圈 · 单位 分:秒/公里 · 柱越高越快</Text>
        <View style={styles.row}>
          <View style={styles.scale}>
            <Text style={styles.axis}>{chartTime(scale.lower)}</Text>
            <Text style={styles.axis}>{chartTime((scale.lower + scale.upper) / 2)}</Text>
            <Text style={styles.axis}>{chartTime(scale.upper)}</Text>
          </View>
          <ScrollView horizontal nestedScrollEnabled style={styles.lapScroll} contentContainerStyle={styles.lapColumns}>
            <Grid />
            {laps.map((lap) => {
              const selected = selectedNumber === lap.number;
              const pace = lap.paceSecPerKm;
              const barHeight = pace ? Math.max(2, (scale.upper - pace) / (scale.upper - scale.lower) * height) : 0;
              return <Pressable key={lap.number} accessibilityRole="button" accessibilityState={{ selected }}
                accessibilityLabel={'第 ' + lap.number + ' 圈配速 ' + (pace ? chartTime(pace) + ' 每公里' : '缺失')}
                onPress={() => setSelectedNumber(lap.number)} style={styles.lapColumn}>
                <View style={styles.barArea}>
                  {pace ? <View style={[styles.bar, { height: barHeight }, selected && styles.barSelected]} />
                    : <Text style={styles.axis}>–</Text>}
                </View>
                <Text style={[styles.lapNumber, selected && styles.lapNumberSelected]}>{lap.number}</Text>
              </Pressable>;
            })}
          </ScrollView>
        </View>
      </> : <Text style={styles.small}>{laps.length} 圈 · 缺少距离或用时，无法绘制圈速。</Text>}
      {selected ? <View style={styles.selection}>
        <Text style={styles.reading}>{lapLabel(selected)}</Text>
      </View> : scale && <Text style={styles.small}>点一圈查看距离、用时和心率。</Text>}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAll }} onPress={() => setShowAll(!showAll)}>
        <Text style={styles.link}>{showAll ? '收起圈明细' : '查看圈明细'}</Text>
      </Pressable>
      {showAll && laps.map((lap) => <Text key={lap.number} style={styles.small}>{lapLabel(lap)}</Text>)}
    </>}
  </View>;
}

function lapLabel(lap: FitLap) {
  return [
    '第 ' + lap.number + ' 圈',
    lap.meters && (lap.meters / 1000).toFixed(2) + ' 公里',
    lap.timerSeconds && '用时 ' + chartTime(lap.timerSeconds),
    lap.paceSecPerKm && chartTime(lap.paceSecPerKm) + '/公里',
    lap.averageHr && '均心率 ' + lap.averageHr,
    lap.maxHr && '最高 ' + lap.maxHr,
    lap.averagePowerW && Math.round(lap.averagePowerW) + ' 瓦',
    lap.ascentM && '爬升 ' + Math.round(lap.ascentM) + ' 米',
  ].filter(Boolean).join(' · ');
}

function HeartChart({ fit, suspect }: { fit: FitActivity; suspect: boolean }) {
  const [width, setWidth] = useState(0);
  const [selectedSecond, setSelectedSecond] = useState<number>();
  const points = fit.heartRate;
  const scale = chartBounds(points.map((point) => point[1]), 10, 5);
  const duration = Math.max(1, fit.elapsedSeconds, points[points.length - 1]?.[0] ?? 0);
  const sample = selectedSecond === undefined ? undefined : heartSampleAt(points, selectedSecond);
  const cursor = sample?.[0] ?? selectedSecond;
  const x = (second: number) => second / duration * width;
  const y = (bpm: number) => scale ? (scale.upper - bpm) / (scale.upper - scale.lower) * height : 0;
  const tick = (fraction: number) => chartTime(duration * fraction);

  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.label}>心率曲线</Text>
    {scale ? <>
      <Text style={styles.small}>{scale.minimum}–{scale.maximum} 次/分 · {fit.heartRateSampleCount} 个有效采样{suspect ? ' · 本节心率存疑' : ''}</Text>
      <View style={styles.row}>
        <View style={styles.scale}>
          <Text style={styles.axis}>{scale.upper}</Text>
          <Text style={styles.axis}>{(scale.upper + scale.lower) / 2}</Text>
          <Text style={styles.axis}>{scale.lower}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="在心率曲线上查看采样"
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={styles.heartPlot}
          onPress={(event) => {
            const pointer = event.nativeEvent as typeof event.nativeEvent & { offsetX?: number };
            const localX = pointer.locationX ?? pointer.offsetX;
            if (width > 0 && Number.isFinite(localX)) {
              setSelectedSecond(Math.max(0, Math.min(duration, Math.round(localX * duration / width))));
            }
          }}>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Grid />
            {width > 0 && points.map(([second, bpm, segment], index) => {
              const previous = points[index - 1];
              const endX = x(second);
              const endY = y(bpm);
              if (!previous || previous[2] !== segment) {
                return <View key={index} style={[styles.heartMark, { left: endX - 1, top: endY - 1 }]} />;
              }
              const startX = x(previous[0]);
              const startY = y(previous[1]);
              const length = Math.hypot(endX - startX, endY - startY);
              return <View key={index} style={[styles.heartMark, { width: length,
                left: (startX + endX - length) / 2, top: (startY + endY) / 2,
                transform: [{ rotate: Math.atan2(endY - startY, endX - startX) + 'rad' }],
              }]} />;
            })}
            {cursor !== undefined && <View style={[styles.cursor, { left: x(cursor) }]} />}
            {sample && <View style={[styles.dot, { left: x(sample[0]) - 4, top: y(sample[1]) - 3 }]} />}
          </View>
        </Pressable>
      </View>
      <View style={styles.timeAxis}>{[0, 0.5, 1].map((fraction) => <Text key={fraction} style={styles.axis}>{tick(fraction)}</Text>)}</View>
      {selectedSecond === undefined ? <Text style={styles.small}>横轴为经过时间。点曲线查看采样，断开的地方缺少记录。</Text>
        : <View style={styles.selection}><Text accessibilityLiveRegion="polite" style={styles.reading}>
          {sample ? chartTime(sample[0]) + ' · ' + sample[1] + ' 次/分' : chartTime(selectedSecond) + ' · 此处无采样'}
        </Text></View>}
    </> : <Text style={styles.small}>这条活动没有可用的心率采样。</Text>}
  </View>;
}

export function FitReview({ fit, heartRateSuspect = false }: { fit: FitActivity; heartRateSuspect?: boolean }) {
  return <View style={styles.group}>
    <LapChart laps={fit.laps} />
    <HeartChart fit={fit} suspect={heartRateSuspect} />
  </View>;
}

const styles = StyleSheet.create({
  group: { gap: 8, marginTop: 5 },
  card: { gap: 7, padding: 10, borderWidth: 1, borderColor: brandTheme.border, borderRadius: 10, backgroundColor: '#fff' },
  label: { color: brandTheme.ink, fontSize: 14, fontWeight: '700' },
  small: { color: brandTheme.muted, fontSize: 12, lineHeight: 18 },
  axis: { color: brandTheme.muted, fontSize: 11, lineHeight: 15, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', gap: 7, alignItems: 'flex-start' },
  scale: { width: 30, height, alignItems: 'flex-end', justifyContent: 'space-between' },
  lapScroll: { flex: 1 },
  lapColumns: { minWidth: '100%', flexDirection: 'row' },
  lapColumn: { width: barWidth, alignItems: 'center' },
  barArea: { height, width: barWidth, justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: 19, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: brandTheme.muted },
  barSelected: { backgroundColor: brandTheme.ink },
  lapNumber: { color: brandTheme.muted, fontSize: 11, lineHeight: 20 },
  lapNumberSelected: { color: brandTheme.ink, fontWeight: '800' },
  grid: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: brandTheme.border },
  heartPlot: { height, flex: 1, borderRadius: 4, backgroundColor: brandTheme.soft, overflow: 'hidden' },
  heartMark: { position: 'absolute', width: 3, height: 2, backgroundColor: '#ac5043', borderRadius: 2 },
  cursor: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#8d5b53' },
  dot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#843d33' },
  timeAxis: { flexDirection: 'row', justifyContent: 'space-between', marginLeft: 37 },
  selection: { padding: 6, paddingHorizontal: 8, backgroundColor: brandTheme.soft, borderRadius: 6 },
  reading: { fontSize: 12, fontWeight: '700', lineHeight: 18, color: brandTheme.ink },
  link: { color: brandTheme.accent, fontSize: 12, paddingVertical: 3, fontWeight: '700' },
});
