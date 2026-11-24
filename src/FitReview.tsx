import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { FitActivity } from './fit';

const clock = (seconds: number) => Math.floor(seconds / 60) + ':' + String(Math.round(seconds) % 60).padStart(2, '0');
const height = 102;

export function FitReview({ fit }: { fit: FitActivity }) {
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(0);
  const points = fit.heartRate;
  const low = Math.min(...points.map((point) => point[1]));
  const high = Math.max(...points.map((point) => point[1]));
  const bottom = Math.max(0, Math.floor((low - 5) / 10) * 10);
  const top = Math.ceil((high + 5) / 10) * 10;
  const duration = Math.max(1, fit.elapsedSeconds, points[points.length - 1]?.[0] ?? 0);
  const x = (second: number) => second / duration * width;
  const y = (bpm: number) => (top - bpm) / (top - bottom) * height;

  return <View style={styles.group}>
    <Text style={styles.label}>FIT 心率曲线</Text>
    {points.length ? <>
      <Text style={styles.small}>{fit.heartRateSampleCount} 个有效采样 · {low}–{high} 次/分 · 横轴为经过时间</Text>
      <View style={styles.row}><View style={styles.scale}><Text style={styles.small}>{top}</Text><Text style={styles.small}>{bottom}</Text></View>
        <View accessibilityLabel={`心率曲线，记录范围 ${low} 至 ${high} 次每分`} accessibilityRole="image"
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={styles.plot}>
          {points.map(([second, bpm, segment], index) => {
            const previous = points[index - 1];
            const endX = x(second);
            const endY = y(bpm);
            if (!previous || previous[2] !== segment) {
              return <View key={index} style={[styles.mark, { left: endX - 1, top: endY - 1 }]} />;
            }
            const startX = x(previous[0]);
            const startY = y(previous[1]);
            const length = Math.hypot(endX - startX, endY - startY);
            return <View key={index} style={[styles.mark, { width: length,
              left: (startX + endX - length) / 2, top: (startY + endY) / 2,
              transform: [{ rotate: Math.atan2(endY - startY, endX - startX) + 'rad' }],
            }]} />;
          })}
        </View>
      </View>
      <View style={styles.between}><Text style={styles.small}>0:00</Text><Text style={styles.small}>{clock(duration)}</Text></View>
    </> : <Text style={styles.small}>FIT 中没有可用的心率采样。</Text>}
    <Text style={styles.label}>FIT 记录圈 · {fit.laps.length} 圈</Text>
    {fit.laps.length ? <>
      {(expanded ? fit.laps : fit.laps.slice(0, 6)).map((lap) => <Text key={lap.number} style={styles.small}>{[
        '第 ' + lap.number + ' 圈',
        lap.meters && (lap.meters / 1000).toFixed(2) + ' 公里',
        lap.timerSeconds && clock(Math.round(lap.timerSeconds)),
        lap.paceSecPerKm && clock(lap.paceSecPerKm) + '/公里',
        lap.averageHr && '均心率 ' + lap.averageHr,
        lap.maxHr && '峰值 ' + lap.maxHr,
        lap.averagePowerW && Math.round(lap.averagePowerW) + ' 瓦',
        lap.ascentM && '爬升 ' + Math.round(lap.ascentM) + ' 米',
      ].filter(Boolean).join(' · ')}</Text>)}
      {fit.laps.length > 6 && <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)}>
        <Text style={styles.link}>{expanded ? '收起圈记录' : '查看全部圈记录'}</Text>
      </Pressable>}
    </> : <Text style={styles.small}>设备未在这条活动中记录圈。</Text>}
  </View>;
}

const styles = StyleSheet.create({
  group: { gap: 5, marginTop: 3 },
  label: { color: '#162f29', fontSize: 14, fontWeight: '700' },
  small: { color: '#566960', fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 7, alignItems: 'stretch' },
  between: { flexDirection: 'row', justifyContent: 'space-between', marginLeft: 27 },
  scale: { justifyContent: 'space-between' },
  plot: { height, flex: 1, backgroundColor: '#eef5ee', borderRadius: 4, overflow: 'hidden' },
  mark: { position: 'absolute', width: 3, height: 2, backgroundColor: '#287354', borderRadius: 2 },
  link: { color: '#256447', fontSize: 13, paddingVertical: 5, fontWeight: '700' },
});
